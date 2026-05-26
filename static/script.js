const REFRESH_INTERVAL_MS = 4000;

const state = {
  users: [],
  locations: [],
  tasks: [],
  currentUserId: null,
  refreshTimer: null,
  isLoadingTasks: false,
};

const elements = {
  userSelect: document.querySelector("#current-user"),
  currentRole: document.querySelector("#current-role"),
  locationsList: document.querySelector("#locations-list"),
  locationsCount: document.querySelector("#locations-count"),
  workspaceSubtitle: document.querySelector("#workspace-subtitle"),
  taskSearch: document.querySelector("#task-search"),
  statusFilter: document.querySelector("#status-filter"),
  priorityFilter: document.querySelector("#priority-filter"),
  tasksSummary: document.querySelector("#tasks-summary"),
  lastUpdated: document.querySelector("#last-updated"),
  overdueSection: document.querySelector("#overdue-section"),
  regularSection: document.querySelector("#regular-section"),
  overdueTasks: document.querySelector("#overdue-tasks"),
  regularTasks: document.querySelector("#regular-tasks"),
  overdueSectionCount: document.querySelector("#overdue-section-count"),
  regularSectionCount: document.querySelector("#regular-section-count"),
  emptyState: document.querySelector("#empty-state"),
  counterAll: document.querySelector("#counter-all"),
  counterNew: document.querySelector("#counter-new"),
  counterProgress: document.querySelector("#counter-progress"),
  counterOverdue: document.querySelector("#counter-overdue"),
  counterReview: document.querySelector("#counter-review"),
  counterDone: document.querySelector("#counter-done"),
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();

  try {
    const [users, locations] = await Promise.all([
      fetchJson("/api/users"),
      fetchJson("/api/locations"),
    ]);

    state.users = users;
    state.locations = locations;
    state.currentUserId = users[0]?.id ?? null;

    renderUsers();
    renderLocations();
    renderCurrentUser();
    await loadTasksForCurrentUser();
    startAutoRefresh();
  } catch (error) {
    console.error("Не удалось загрузить стартовые данные", error);
    renderLoadError();
  }
}

function bindEvents() {
  elements.userSelect.addEventListener("change", async (event) => {
    state.currentUserId = Number(event.target.value);
    renderCurrentUser();
    renderLocations();
    await loadTasksForCurrentUser();
  });

  elements.taskSearch.addEventListener("input", renderTasks);
  elements.statusFilter.addEventListener("change", renderTasks);
  elements.priorityFilter.addEventListener("change", renderTasks);
}

function startAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
  }

  state.refreshTimer = setInterval(() => {
    loadTasksForCurrentUser({ silent: true });
  }, REFRESH_INTERVAL_MS);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status}`);
  }
  return response.json();
}

async function loadTasksForCurrentUser(options = {}) {
  if (!state.currentUserId || state.isLoadingTasks) {
    return;
  }

  state.isLoadingTasks = true;
  if (!options.silent) {
    elements.tasksSummary.textContent = "Загрузка задач...";
  }

  try {
    state.tasks = await fetchJson(`/api/tasks?user_id=${state.currentUserId}`);
    renderTasks();
    elements.lastUpdated.textContent = `Обновлено: ${formatTime(new Date())}`;
  } catch (error) {
    console.error("Не удалось загрузить задачи", error);
    elements.tasksSummary.textContent = "Не удалось загрузить задачи";
    clearTaskContainers();
    elements.emptyState.classList.remove("hidden");
  } finally {
    state.isLoadingTasks = false;
  }
}

function renderUsers() {
  elements.userSelect.innerHTML = "";

  for (const user of state.users) {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = `${user.name} · ${roleLabel(user.role)}`;
    elements.userSelect.appendChild(option);
  }

  if (state.currentUserId) {
    elements.userSelect.value = String(state.currentUserId);
  }
}

function renderLocations() {
  const user = getCurrentUser();
  const allowedLocationIds = new Set((user?.locations ?? []).map((location) => location.id));
  const visibleLocations = user?.role === "manager"
    ? state.locations.filter((location) => allowedLocationIds.has(location.id))
    : state.locations;

  elements.locationsList.innerHTML = "";
  elements.locationsCount.textContent = String(visibleLocations.length);

  for (const location of visibleLocations) {
    const item = document.createElement("li");
    const isAvailable = user?.role !== "manager" || allowedLocationIds.has(location.id);
    item.className = `location-item${isAvailable ? "" : " unavailable"}`;
    item.innerHTML = `
      <span class="location-name"></span>
      <span class="location-status" aria-hidden="true"></span>
    `;
    item.querySelector(".location-name").textContent = location.name;
    elements.locationsList.appendChild(item);
  }
}

function renderCurrentUser() {
  const user = getCurrentUser();
  if (!user) {
    elements.currentRole.textContent = "Роль не выбрана";
    elements.workspaceSubtitle.textContent = "Выберите пользователя для просмотра задач";
    return;
  }

  const locationNames = user.locations.map((location) => location.name).join(", ");
  elements.currentRole.textContent = `${roleLabel(user.role)} · ${locationNames || "без заведений"}`;
  elements.workspaceSubtitle.textContent = `${user.name}: доступ ${locationNames || "не настроен"}`;
}

function renderTasks() {
  const filteredTasks = getFilteredTasks();
  const overdueTasks = filteredTasks.filter((task) => task.status === "Просрочена");
  const regularTasks = filteredTasks.filter((task) => task.status !== "Просрочена");

  clearTaskContainers();

  for (const task of overdueTasks) {
    elements.overdueTasks.appendChild(createTaskCard(task));
  }

  for (const task of regularTasks) {
    elements.regularTasks.appendChild(createTaskCard(task));
  }

  elements.overdueSectionCount.textContent = String(overdueTasks.length);
  elements.regularSectionCount.textContent = String(regularTasks.length);
  elements.overdueSection.classList.toggle("hidden", overdueTasks.length === 0);
  elements.regularSection.classList.toggle("hidden", regularTasks.length === 0);
  elements.emptyState.classList.toggle("hidden", filteredTasks.length > 0);
  elements.tasksSummary.textContent = getTasksSummary(filteredTasks);
  renderCounters();
}

function createTaskCard(task) {
  const card = document.createElement("article");
  const statusClass = statusClassName(task.status);
  const priorityClass = priorityClassName(task.priority);
  card.className = `task-card ${statusClass} ${priorityClass}`;

  card.innerHTML = `
    <div class="task-card-head">
      <h3 class="task-title"></h3>
      <p class="task-description"></p>
    </div>
    <div class="task-meta">
      <div class="meta-item">
        <span class="meta-label">Статус</span>
        <span class="status-badge ${statusClass}"></span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Приоритет</span>
        <span class="priority-badge ${priorityClass}"></span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Срок</span>
        <span class="meta-value due-value"></span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Исполнитель</span>
        <span class="meta-value assignee-value"></span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Заведение</span>
        <span class="meta-value location-value"></span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Автор</span>
        <span class="meta-value author-value"></span>
      </div>
    </div>
    <p class="task-comment"></p>
    <div class="task-actions"></div>
  `;

  card.querySelector(".task-title").textContent = task.title;
  card.querySelector(".task-description").textContent = task.description || "Описание не указано";
  card.querySelector(".status-badge").textContent = task.status;
  card.querySelector(".priority-badge").textContent = task.priority;
  card.querySelector(".due-value").textContent = formatDateTime(task.due_at);
  card.querySelector(".assignee-value").textContent = task.assignee?.name ?? "Не назначен";
  card.querySelector(".location-value").textContent = task.location?.name ?? "Не указано";
  card.querySelector(".author-value").textContent = task.author?.name ?? "Не указан";
  card.querySelector(".task-comment").textContent = task.comment || "Комментариев пока нет";
  renderTaskActions(card.querySelector(".task-actions"), task);

  return card;
}

function renderTaskActions(container, task) {
  const user = getCurrentUser();
  const canAct = user?.role === "owner" || user?.role === "manager";
  container.innerHTML = "";

  if (!canAct) {
    return;
  }

  const actions = user.role === "owner"
    ? ["На проверку", "Выполнена", "Отменена"]
    : ["В работу", "На проверку"];

  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `task-action${action === "Выполнена" ? " primary" : ""}`;
    button.textContent = action;
    button.title = `Действие для задачи #${task.id}`;
    container.appendChild(button);
  }
}

function getFilteredTasks() {
  const query = elements.taskSearch.value.trim().toLowerCase();
  const status = elements.statusFilter.value;
  const priority = elements.priorityFilter.value;

  return state.tasks.filter((task) => {
    const haystack = [
      task.title,
      task.description,
      task.status,
      task.priority,
      task.assignee?.name,
      task.location?.name,
      task.comment,
    ].join(" ").toLowerCase();

    return (!query || haystack.includes(query))
      && (!status || task.status === status)
      && (!priority || task.priority === priority);
  });
}

function clearTaskContainers() {
  elements.overdueTasks.innerHTML = "";
  elements.regularTasks.innerHTML = "";
}

function renderCounters() {
  elements.counterAll.textContent = String(state.tasks.length);
  elements.counterNew.textContent = String(countTasksByStatus("Новая"));
  elements.counterProgress.textContent = String(countTasksByStatus("В работе"));
  elements.counterOverdue.textContent = String(countTasksByStatus("Просрочена"));
  elements.counterReview.textContent = String(countTasksByStatus("На проверке"));
  elements.counterDone.textContent = String(countTasksByStatus("Выполнена"));
}

function renderLoadError() {
  elements.userSelect.innerHTML = "<option>Ошибка загрузки</option>";
  elements.currentRole.textContent = "Проверьте, запущен ли сервер FastAPI";
  elements.locationsList.innerHTML = "<li class=\"error-text\">API недоступен</li>";
  elements.locationsCount.textContent = "0";
  elements.tasksSummary.textContent = "API недоступен";
}

function countTasksByStatus(status) {
  return state.tasks.filter((task) => task.status === status).length;
}

function getTasksSummary(tasks) {
  const user = getCurrentUser();
  const suffix = user ? `для ${user.name}` : "";
  return `${tasks.length} задач ${suffix}`.trim();
}

function getCurrentUser() {
  return state.users.find((item) => item.id === state.currentUserId);
}

function roleLabel(role) {
  const labels = {
    owner: "Управляющий",
    manager: "Менеджер",
  };
  return labels[role] ?? role;
}

function statusClassName(status) {
  const classes = {
    "Новая": "status-new",
    "В работе": "status-progress",
    "Выполнена": "status-done",
    "Просрочена": "status-overdue",
  };
  return classes[status] ?? "status-new";
}

function priorityClassName(priority) {
  if (priority === "Критический" || priority === "Критическая") {
    return "priority-critical";
  }
  return "priority-normal";
}

function formatDateTime(value) {
  if (!value) {
    return "Без срока";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(date) {
  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
