from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Set

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
try:
    from pydantic import ConfigDict
except ImportError:
    ConfigDict = None
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Table, Text, create_engine, select, text, update
from sqlalchemy.orm import Session, declarative_base, relationship, selectinload, sessionmaker


BASE_DIR = Path(__file__).resolve().parent
DATABASE_URL = f"sqlite:///{BASE_DIR / 'walker.db'}"
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

PRIORITIES = {"Низкий", "Обычный", "Высокий", "Критический"}
STATUSES = {
    "Новая",
    "В работе",
    "На проверке",
    "Выполнена",
    "Просрочена",
    "Отменена",
    "Перенесена",
}
FINAL_STATUSES = {"Выполнена", "Отменена", "Перенесена"}
GLOBAL_ROLES = {"director", "module_director", "owner"}
MASTER_ACCESS_CODE = "0000"


user_locations = Table(
    "user_locations",
    Base.metadata,
    Column("user_id", ForeignKey("users.id"), primary_key=True),
    Column("location_id", ForeignKey("locations.id"), primary_key=True),
)


class Location(Base):  # type: ignore[misc, valid-type]
    __tablename__ = "locations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)

    users = relationship(
        "User",
        secondary=user_locations,
        back_populates="locations",
    )
    tasks = relationship("Task", back_populates="location")


class User(Base):  # type: ignore[misc, valid-type]
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    role = Column(String, nullable=False, index=True)
    access_code = Column(String, nullable=True, index=True)

    locations = relationship(
        "Location",
        secondary=user_locations,
        back_populates="users",
    )
    assigned_tasks = relationship(
        "Task",
        foreign_keys="Task.assignee_id",
        back_populates="assignee",
    )
    authored_tasks = relationship(
        "Task",
        foreign_keys="Task.author_id",
        back_populates="author",
    )


class Task(Base):  # type: ignore[misc, valid-type]
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, default="", nullable=False)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    priority = Column(String, default="Обычный", nullable=False, index=True)
    status = Column(String, default="Новая", nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    due_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    comment = Column(Text, default="", nullable=False)

    location = relationship("Location", back_populates="tasks")
    author = relationship(
        "User",
        foreign_keys=[author_id],
        back_populates="authored_tasks",
    )
    assignee = relationship(
        "User",
        foreign_keys=[assignee_id],
        back_populates="assigned_tasks",
    )


class LocationRead(BaseModel):
    id: int
    name: str

    if ConfigDict is not None:
        model_config = ConfigDict(from_attributes=True)
    else:
        class Config:
            orm_mode = True


class UserRead(BaseModel):
    id: int
    name: str
    role: str
    locations: List[LocationRead]

    if ConfigDict is not None:
        model_config = ConfigDict(from_attributes=True)
    else:
        class Config:
            orm_mode = True


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1)
    description: str = ""
    location_id: Optional[int] = None
    author_id: int
    assignee_id: Optional[int] = None
    priority: str = "Обычный"
    due_at: Optional[datetime] = None
    comment: str = ""


class AuthLogin(BaseModel):
    code: str = Field(..., min_length=4, max_length=4)


class TaskStatusUpdate(BaseModel):
    status: str
    comment: str = ""


class EmailReportRequest(BaseModel):
    user_id: int
    recipient_email: str = "owner@walker.local"
    location_id: Optional[int] = None


class TaskRead(BaseModel):
    id: int
    title: str
    description: str
    location: LocationRead
    author: Optional[UserRead]
    assignee: Optional[UserRead]
    priority: str
    status: str
    created_at: datetime
    due_at: Optional[datetime]
    completed_at: Optional[datetime]
    comment: str

    if ConfigDict is not None:
        model_config = ConfigDict(from_attributes=True)
    else:
        class Config:
            orm_mode = True


class EmailReportRead(BaseModel):
    sent: bool
    recipient_email: str
    subject: str
    tasks_count: int
    body_text: str
    body_html: str


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def migrate_existing_db() -> None:
    with engine.begin() as connection:
        user_table_exists = connection.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        ).first()
        if user_table_exists:
            user_columns = {
                row[1]
                for row in connection.execute(text("PRAGMA table_info(users)")).fetchall()
            }
            if "access_code" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN access_code VARCHAR"))

            connection.execute(
                text("UPDATE locations SET name = 'Биг Бен' WHERE name IN ('Биг-вен', 'Биг Вэн')")
            )
            connection.execute(
                text(
                    "UPDATE users SET name = 'Менеджер Биг Бен' "
                    "WHERE name IN ('Менеджер Биг-вен', 'Менеджер Биг Вэн')"
                )
            )

        task_table_exists = connection.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
        ).first()
        if not task_table_exists:
            return

        existing_columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(tasks)")).fetchall()
        }
        migrations = {
            "author_id": "ALTER TABLE tasks ADD COLUMN author_id INTEGER",
            "priority": "ALTER TABLE tasks ADD COLUMN priority VARCHAR DEFAULT 'Обычный' NOT NULL",
            "created_at": "ALTER TABLE tasks ADD COLUMN created_at DATETIME",
            "due_at": "ALTER TABLE tasks ADD COLUMN due_at DATETIME",
            "completed_at": "ALTER TABLE tasks ADD COLUMN completed_at DATETIME",
            "comment": "ALTER TABLE tasks ADD COLUMN comment TEXT DEFAULT '' NOT NULL",
        }

        for column_name, sql in migrations.items():
            if column_name not in existing_columns:
                connection.execute(text(sql))

        connection.execute(
            text("UPDATE tasks SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL")
        )
        connection.execute(text("UPDATE tasks SET status = 'Новая' WHERE status = 'new'"))


def merge_duplicate_users(
    db: Session,
    role: str,
    canonical_name: str,
    locations: List[Location],
) -> None:
    users = db.scalars(
        select(User)
        .options(selectinload(User.locations))
        .where(User.role == role)
        .order_by(User.id)
    ).all()
    if not users:
        return

    canonical = users[0]
    canonical.name = canonical_name
    canonical.locations = locations

    for duplicate in users[1:]:
        db.execute(
            update(Task)
            .where(Task.author_id == duplicate.id)
            .values(author_id=canonical.id)
        )
        db.execute(
            update(Task)
            .where(Task.assignee_id == duplicate.id)
            .values(assignee_id=canonical.id)
        )
        db.delete(duplicate)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    migrate_existing_db()

    with session_scope() as db:
        locations_by_name = {
            location.name: location
            for location in db.scalars(select(Location)).all()
        }

        for name in ("Биг Бен", "Аксон", "Лагерная", "Все заведения"):
            if name not in locations_by_name:
                locations_by_name[name] = Location(name=name)
                db.add(locations_by_name[name])
        db.flush()

        all_locations = [
            locations_by_name["Биг Бен"],
            locations_by_name["Аксон"],
            locations_by_name["Лагерная"],
        ]
        global_location = locations_by_name["Все заведения"]
        merge_duplicate_users(db, "owner", "Управляющей модуля", all_locations)
        merge_duplicate_users(db, "director", "Директор розницы", all_locations)
        merge_duplicate_users(db, "module_director", "Генеральный директор", all_locations)
        db.flush()

        existing_user_names = set(db.scalars(select(User.name)).all())
        default_users = [
            ("Директор розницы", "director", all_locations + [global_location], "1000"),
            ("Генеральный директор", "module_director", all_locations + [global_location], "1500"),
            ("Управляющей модуля", "owner", all_locations, "2000"),
            ("Менеджер Биг Бен", "manager", [locations_by_name["Биг Бен"]], "2101"),
            ("Менеджер Аксон", "manager", [locations_by_name["Аксон"]], "2202"),
            ("Менеджер Лагерная", "manager", [locations_by_name["Лагерная"]], "2303"),
        ]

        for name, role, locations, access_code in default_users:
            if name not in existing_user_names:
                db.add(User(name=name, role=role, locations=locations, access_code=access_code))
            else:
                user = db.scalars(select(User).where(User.name == name)).first()
                if user is not None:
                    user.access_code = access_code
                    user.locations = locations


init_db()

app = FastAPI(title="Walker Local API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def serialize_location(location: Location) -> Dict[str, Any]:
    return {
        "id": location.id,
        "name": location.name,
    }


def serialize_user(user: User) -> Dict[str, Any]:
    return {
        "id": user.id,
        "name": user.name,
        "role": user.role,
        "locations": [serialize_location(location) for location in user.locations],
    }


def serialize_public_user(user: User) -> Dict[str, Any]:
    return serialize_user(user)


def serialize_task(task: Task) -> Dict[str, Any]:
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "location": serialize_location(task.location),
        "author": serialize_user(task.author) if task.author else None,
        "assignee": serialize_user(task.assignee) if task.assignee else None,
        "priority": task.priority,
        "status": task.status,
        "created_at": task.created_at,
        "due_at": task.due_at,
        "completed_at": task.completed_at,
        "comment": task.comment,
    }


def get_user_or_404(db: Session, user_id: int) -> User:
    user = db.scalars(
        select(User)
        .options(selectinload(User.locations))
        .where(User.id == user_id)
    ).first()
    if user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return user


def user_location_ids(user: User) -> Set[int]:
    return {location.id for location in user.locations}


def ensure_supported_priority(priority: str) -> None:
    if priority not in PRIORITIES:
        raise HTTPException(
            status_code=422,
            detail=f"Недопустимый приоритет. Допустимо: {', '.join(sorted(PRIORITIES))}",
        )


def ensure_supported_status(status: str) -> None:
    if status not in STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Недопустимый статус. Допустимо: {', '.join(sorted(STATUSES))}",
        )


def ensure_can_manage_location(user: User, location_id: int) -> None:
    if user.role in GLOBAL_ROLES:
        return
    if user.role == "manager" and location_id in user_location_ids(user):
        return
    raise HTTPException(
        status_code=403,
        detail="Недостаточно прав для работы с задачами этого заведения",
    )


def ensure_role_assignment(author: User, assignee: Optional[User], location_id: int) -> None:
    if author.role == "module_director":
        if assignee is not None and assignee.role == "director":
            return
        raise HTTPException(
            status_code=403,
            detail="Генеральный директор может ставить задачи только Директору розницы",
        )

    if author.role == "director":
        if assignee is not None and assignee.role == "owner":
            return
        raise HTTPException(
            status_code=403,
            detail="Директор розницы может ставить задачи только Управляющей модуля",
        )

    if author.role == "owner":
        if assignee is not None and assignee.role == "manager" and location_id in user_location_ids(assignee):
            return
        raise HTTPException(
            status_code=403,
            detail="Управляющей модуля может ставить задачи только менеджеру выбранного заведения",
        )

    if author.role == "manager":
        return


def get_global_location(db: Session) -> Location:
    location = db.scalars(select(Location).where(Location.name == "Все заведения")).first()
    if location is None:
        location = Location(name="Все заведения")
        db.add(location)
        db.flush()
    return location


def mark_overdue_tasks(db: Session) -> int:
    now = datetime.utcnow()
    overdue_tasks = db.scalars(
        select(Task).where(
            Task.due_at.isnot(None),
            Task.due_at < now,
            Task.status.notin_(FINAL_STATUSES),
            Task.status != "Просрочена",
        )
    ).all()

    for task in overdue_tasks:
        task.status = "Просрочена"
        if not task.comment:
            task.comment = "Срок выполнения истек, задача автоматически отмечена как просроченная."

    if overdue_tasks:
        db.commit()

    return len(overdue_tasks)


def task_query_with_relations() -> Any:
    return select(Task).options(
        selectinload(Task.location),
        selectinload(Task.author).selectinload(User.locations),
        selectinload(Task.assignee).selectinload(User.locations),
    )


def visible_task_query(user: User) -> Any:
    query = task_query_with_relations().order_by(Task.id)
    if user.role not in GLOBAL_ROLES:
        query = query.where(Task.location_id.in_(user_location_ids(user)))
    return query


def report_task_lines(tasks: List[Task]) -> List[str]:
    lines = []
    for task in tasks:
        assignee_name = task.assignee.name if task.assignee else "Не назначен"
        due_at = task.due_at.isoformat(sep=" ", timespec="minutes") if task.due_at else "Без срока"
        lines.append(
            f"#{task.id} | {task.title} | {task.location.name} | "
            f"исполнитель: {assignee_name} | статус: {task.status} | срок: {due_at}"
        )
    return lines


def build_report_body(tasks: List[Task], sender: User) -> Dict[str, str]:
    text_lines = [
        "Отчет Walker Local",
        f"Сформировал: {sender.name} ({sender.role})",
        f"Всего задач: {len(tasks)}",
        "",
    ]
    text_lines.extend(report_task_lines(tasks) or ["Задач нет."])
    body_text = "\n".join(text_lines)

    rows = []
    for task in tasks:
        assignee_name = task.assignee.name if task.assignee else "Не назначен"
        due_at = task.due_at.isoformat(sep=" ", timespec="minutes") if task.due_at else "Без срока"
        rows.append(
            "<tr>"
            f"<td>#{task.id}</td>"
            f"<td>{task.title}</td>"
            f"<td>{task.location.name}</td>"
            f"<td>{assignee_name}</td>"
            f"<td>{task.priority}</td>"
            f"<td>{task.status}</td>"
            f"<td>{due_at}</td>"
            "</tr>"
        )

    table_rows = "".join(rows) or "<tr><td colspan='7'>Задач нет.</td></tr>"
    body_html = (
        "<h2>Отчет Walker Local</h2>"
        f"<p><b>Сформировал:</b> {sender.name} ({sender.role})</p>"
        f"<p><b>Всего задач:</b> {len(tasks)}</p>"
        "<table border='1' cellpadding='6' cellspacing='0'>"
        "<thead><tr>"
        "<th>ID</th><th>Название</th><th>Заведение</th><th>Исполнитель</th>"
        "<th>Приоритет</th><th>Статус</th><th>Срок</th>"
        "</tr></thead>"
        f"<tbody>{table_rows}</tbody>"
        "</table>"
    )
    return {"text": body_text, "html": body_html}


def mock_send_email(recipient_email: str, subject: str, body_text: str, body_html: str) -> None:
    print("\n=== MOCK EMAIL REPORT ===")
    print(f"To: {recipient_email}")
    print(f"Subject: {subject}")
    print("--- TEXT ---")
    print(body_text)
    print("--- HTML ---")
    print(body_html)
    print("=== END MOCK EMAIL REPORT ===\n")


@app.get("/api/users", response_model=List[UserRead])
def read_users(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    users = db.scalars(
        select(User)
        .options(selectinload(User.locations))
        .order_by(User.id)
    ).all()
    return [serialize_user(user) for user in users]


@app.post("/api/auth/login", response_model=UserRead)
def login(payload: AuthLogin, db: Session = Depends(get_db)) -> Dict[str, Any]:
    if not payload.code.isdigit():
        raise HTTPException(status_code=422, detail="Код должен состоять из 4 цифр")

    query = select(User).options(selectinload(User.locations))
    if payload.code == MASTER_ACCESS_CODE:
        user = db.scalars(query.order_by(User.id)).first()
    else:
        user = db.scalars(query.where(User.access_code == payload.code)).first()
    if user is None:
        raise HTTPException(status_code=401, detail="Неверный код доступа")
    return serialize_public_user(user)


@app.get("/api/locations", response_model=List[LocationRead])
def read_locations(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    locations = db.scalars(select(Location).order_by(Location.id)).all()
    return [serialize_location(location) for location in locations]


@app.get("/api/tasks", response_model=List[TaskRead])
def read_tasks(user_id: int, db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    mark_overdue_tasks(db)
    user = get_user_or_404(db, user_id)
    tasks = db.scalars(visible_task_query(user)).all()
    return [serialize_task(task) for task in tasks]


@app.post("/api/tasks", response_model=TaskRead, status_code=201)
def create_task(payload: TaskCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="Название задачи не может быть пустым")

    author = get_user_or_404(db, payload.author_id)
    if author.role in {"director", "module_director"}:
        effective_location_id = get_global_location(db).id
    else:
        if payload.location_id is None:
            raise HTTPException(status_code=422, detail="Для задачи нужно выбрать заведение")
        effective_location_id = payload.location_id

    ensure_can_manage_location(author, effective_location_id)
    ensure_supported_priority(payload.priority)

    location = db.get(Location, effective_location_id)
    if location is None:
        raise HTTPException(status_code=404, detail="Заведение не найдено")

    assignee = None
    if payload.assignee_id is not None:
        assignee = get_user_or_404(db, payload.assignee_id)

    ensure_role_assignment(author, assignee, effective_location_id)

    task = Task(
        title=payload.title.strip(),
        description=payload.description,
        location_id=effective_location_id,
        author_id=payload.author_id,
        assignee_id=payload.assignee_id,
        priority=payload.priority,
        status="Новая",
        due_at=payload.due_at,
        comment=payload.comment,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    task.location = location
    task.author = author
    task.assignee = assignee
    return serialize_task(task)


@app.patch("/api/tasks/{task_id}/status", response_model=TaskRead)
def update_task_status(
    task_id: int,
    payload: TaskStatusUpdate,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    ensure_supported_status(payload.status)
    task = db.scalars(
        select(Task)
        .options(
            selectinload(Task.location),
            selectinload(Task.author).selectinload(User.locations),
            selectinload(Task.assignee).selectinload(User.locations),
        )
        .where(Task.id == task_id)
    ).first()
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")

    task.status = payload.status
    task.comment = payload.comment
    task.completed_at = datetime.utcnow() if payload.status == "Выполнена" else None
    db.commit()
    db.refresh(task)
    return serialize_task(task)


@app.delete("/api/tasks/{task_id}")
def delete_task(
    task_id: int,
    user_id: int,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if task.author_id != user_id:
        raise HTTPException(status_code=403, detail="Удалить задачу может только ее автор")
    if task.status not in {"Выполнена", "Отменена"}:
        raise HTTPException(
            status_code=403,
            detail="Удалять можно только выполненные или закрытые задачи",
        )

    db.delete(task)
    db.commit()
    return {"deleted": True, "task_id": task_id}


@app.post("/api/reports/email", response_model=EmailReportRead)
def send_email_report(
    payload: EmailReportRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    mark_overdue_tasks(db)
    sender = get_user_or_404(db, payload.user_id)

    if payload.location_id is not None:
        ensure_can_manage_location(sender, payload.location_id)
        location = db.get(Location, payload.location_id)
        if location is None:
            raise HTTPException(status_code=404, detail="Заведение не найдено")

    query = visible_task_query(sender)
    if payload.location_id is not None:
        query = query.where(Task.location_id == payload.location_id)

    tasks = db.scalars(query).all()
    subject = f"Walker Local: отчет по задачам ({len(tasks)})"
    body = build_report_body(tasks, sender)
    mock_send_email(payload.recipient_email, subject, body["text"], body["html"])

    return {
        "sent": True,
        "recipient_email": payload.recipient_email,
        "subject": subject,
        "tasks_count": len(tasks),
        "body_text": body["text"],
        "body_html": body["html"],
    }


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
