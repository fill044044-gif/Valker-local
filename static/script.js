const REFRESH_INTERVAL_MS = 4000;
const MASTER_ACCESS_CODE = "0000";

const state = {
  users: [],
  locations: [],
  tasks: [],
  currentUserId: null,
  selectedLocationId: null,
  refreshTimer: null,
  isLoadingTasks: false,
};

const elements = {
  userSelect: document.querySelector("#current-user"),
  currentRole: document.querySelector("#current-role"),
  switchUserButton: document.querySelector("#switch-user-button"),
  locationsList: document.querySelector("#locations-list"),
  locationsCount: document.querySelector("#locations-count"),
  workspaceSubtitle: document.querySelector("#workspace-subtitle"),
  taskSearch: document.querySelector("#task-search"),
  statusFilter: document.querySelector("#status-filter"),
  priorityFilter: document.querySelector("#priority-filter"),
  tasksSummary: document.querySelector("#tasks-summary"),
  lastUpdated: document.querySelector("#last-updated"),
  assignedTasks: document.querySelector("#assigned-tasks"),
  authoredTasks: document.querySelector("#authored-tasks"),
  assignedSectionCount: document.querySelector("#assigned-section-count"),
  authoredSectionCount: document.querySelector("#authored-section-count"),
  emptyState: document.querySelector("#empty-state"),
  counterAll: document.querySelector("#counter-all"),
  counterNew: document.querySelector("#counter-new"),
  counterProgress: document.querySelector("#counter-progress"),
  counterOverdue: document.querySelector("#counter-overdue"),
  counterReview: document.querySelector("#counter-review"),
  counterDone: document.querySelector("#counter-done"),
  sidebarFilterButtons: document.querySelectorAll("[data-status-filter]"),
  createTaskButton: document.querySelector("#create-task-button"),
  taskModal: document.querySelector("#task-modal"),
  taskForm: document.querySelector("#task-form"),
  taskTitleInput: document.querySelector("#task-title-input"),
  taskDescriptionInput: document.querySelector("#task-description-input"),
  taskLocationField: document.querySelector("#task-location-field"),
  taskLocationInput: document.querySelector("#task-location-input"),
  taskAssigneeInput: document.querySelector("#task-assignee-input"),
  taskPriorityInput: document.querySelector("#task-priority-input"),
  taskDueInput: document.querySelector("#task-due-input"),
  taskCommentInput: document.querySelector("#task-comment-input"),
  taskFormError: document.querySelector("#task-form-error"),
  statusModal: document.querySelector("#status-modal"),
  statusForm: document.querySelector("#status-form"),
  statusTaskId: document.querySelector("#status-task-id"),
  statusNextValue: document.querySelector("#status-next-value"),
  statusCommentInput: document.querySelector("#status-comment-input"),
  statusFormError: document.querySelector("#status-form-error"),
  authModal: document.querySelector("#auth-modal"),
  authForm: document.querySelector("#auth-form"),
  authUserInput: document.querySelector("#auth-user-input"),
  authCodeInput: document.querySelector("#auth-code-input"),
  authFormError: document.querySelector("#auth-form-error"),
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
    state.currentUserId = null;

    renderUsers();
    renderLocations();
    renderCurrentUser();
    startAutoRefresh();
    openAuthModal();
  } catch (error) {
    console.error("Не удалось загрузить стартовые данные", error);
    renderLoadError();
  }
}

function bindEvents() {
  elements.userSelect.addEventListener("change", async (event) => {
    state.currentUserId = Number(event.target.value);
    state.selectedLocationId = null;
    renderCurrentUser();
    renderLocations();
    await loadTasksForCurrentUser();
  });

  elements.taskSearch.addEventListener("input", renderTasks);
  elements.statusFilter.addEventListener("change", renderTasks);
  elements.priorityFilter.addEventListener("change", renderTasks);
  elements.taskLocationInput.addEventListener("change", () => {
    const user = getCurrentUser();
    if (user) {
      renderAssigneeOptions(user);
    }
  });
  elements.createTaskButton.addEventListener("click", openCreateTaskModal);
  elements.switchUserButton.addEventListener("click", openAuthModal);
  elements.taskForm.addEventListener("submit", submitTaskForm);
  elements.statusForm.addEventListener("submit", submitStatusForm);
  elements.authForm.addEventListener("submit", submitAuthForm);

  for (const button of elements.sidebarFilterButtons) {
    button.addEventListener("click", () => {
      elements.statusFilter.value = button.dataset.statusFilter;
      renderTasks();
      updateSidebarFilterState();
      document.querySelector(".tasks-area").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  document.addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close-modal]");
    if (!closeTarget) {
      return;
    }

    closeModal(closeTarget.dataset.closeModal);
  });
}

function openAuthModal() {
  hideFormError(elements.authFormError);
  elements.authForm.reset();
  renderAuthUsers();
  elements.authModal.classList.remove("hidden");
  elements.authUserInput.focus();
}

async function submitAuthForm(event) {
  event.preventDefault();
  const code = elements.authCodeInput.value.replace(/\D/g, "").slice(0, 4);
  const selectedUserId = Number(elements.authUserInput.value);
  elements.authCodeInput.value = code;

  if (!selectedUserId) {
    showFormError(elements.authFormError, "Выберите пользователя");
    return;
  }

  if (code.length !== 4) {
    showFormError(elements.authFormError, "Введите 4 цифры кода");
    return;
  }

  if (code === MASTER_ACCESS_CODE) {
    const selectedUser = state.users.find((user) => user.id === selectedUserId);
    if (!selectedUser) {
      showFormError(elements.authFormError, "Выбранный пользователь не найден");
      return;
    }
    await enterAsUser(selectedUser);
    return;
  }

  try {
    const user = await sendJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    if (user.id !== selectedUserId) {
      showFormError(elements.authFormError, "Код не подходит выбранному пользователю");
      return;
    }
    await enterAsUser(user);
  } catch (error) {
    const localUser = findUserByKnownCode(code);
    if (localUser && localUser.id === selectedUserId) {
      await enterAsUser(localUser);
      return;
    }
    showFormError(elements.authFormError, localUser ? "Код не подходит выбранному пользователю" : error.message);
  }
}

async function enterAsUser(user) {
  state.currentUserId = user.id;
  state.selectedLocationId = null;
  elements.userSelect.value = String(user.id);
  elements.authModal.classList.add("hidden");
  renderCurrentUser();
  renderLocations();
  await loadTasksForCurrentUser();
}

function renderAuthUsers() {
  elements.authUserInput.innerHTML = "<option value=\"\">Выберите пользователя</option>";
  for (const user of state.users) {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = `${user.name} · ${roleLabel(user.role)}`;
    elements.authUserInput.appendChild(option);
  }
  if (state.currentUserId) {
    elements.authUserInput.value = String(state.currentUserId);
  }
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

async function sendJson(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(formatApiError(data, response.status));
  }

  return data;
}

function formatApiError(data, status) {
  if (!data) {
    return `Ошибка запроса: ${status}`;
  }

  const detail = data.detail ?? data.message ?? data.error ?? data;
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        const place = Array.isArray(item.loc) ? item.loc.join(".") : "";
        const message = item.msg || item.message || JSON.stringify(item);
        return place ? `${place}: ${message}` : message;
      })
      .join("; ");
  }

  if (typeof detail === "object") {
    return detail.msg || detail.message || JSON.stringify(detail);
  }

  return String(detail);
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
  elements.userSelect.disabled = true;

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
  const businessLocations = state.locations.filter((location) => location.name !== "Все заведения");
  const visibleLocations = user?.role === "manager"
    ? businessLocations.filter((location) => allowedLocationIds.has(location.id))
    : businessLocations;

  elements.locationsList.innerHTML = "";
  elements.locationsCount.textContent = String(visibleLocations.length);

  for (const location of visibleLocations) {
    const item = document.createElement("li");
    const isAvailable = user?.role !== "manager" || allowedLocationIds.has(location.id);
    const isActive = state.selectedLocationId === location.id;
    item.className = `location-item${isAvailable ? "" : " unavailable"}${isActive ? " active" : ""}`;
    item.innerHTML = `
      <span class="location-name"></span>
      <span class="location-status" aria-hidden="true"></span>
    `;
    item.querySelector(".location-name").textContent = location.name;
    item.addEventListener("click", () => {
      state.selectedLocationId = state.selectedLocationId === location.id ? null : location.id;
      renderLocations();
      renderTasks();
      document.querySelector(".tasks-area").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    elements.locationsList.appendChild(item);
  }
}

function openCreateTaskModal() {
  const user = getCurrentUser();
  if (!user) {
    return;
  }

  elements.taskForm.reset();
  elements.taskPriorityInput.value = "Обычный";
  hideFormError(elements.taskFormError);
  renderTaskFormOptions(user);
  elements.taskModal.classList.remove("hidden");
  elements.taskTitleInput.focus();
}

function renderTaskFormOptions(user) {
  const allowedLocationIds = new Set(user.locations.map((location) => location.id));
  const isDirector = isDirectorRole(user);
  const locationOptions = user.role === "manager"
    ? state.locations.filter((location) => allowedLocationIds.has(location.id))
    : state.locations.filter((location) => location.name !== "Все заведения");

  elements.taskLocationField.classList.toggle("hidden", isDirector);
  elements.taskLocationInput.innerHTML = "";
  for (const location of locationOptions) {
    const option = document.createElement("option");
    option.value = location.id;
    option.textContent = location.name;
    elements.taskLocationInput.appendChild(option);
  }
  elements.taskLocationInput.disabled = user.role === "manager" || isDirector;
  renderAssigneeOptions(user);
}

function renderAssigneeOptions(user) {
  const selectedLocationId = Number(elements.taskLocationInput.value);
  const allowedLocationIds = new Set(user.locations.map((location) => location.id));
  const allowEmptyAssignee = !isDirectorRole(user) && user.role !== "owner";
  elements.taskAssigneeInput.innerHTML = allowEmptyAssignee ? "<option value=\"\">Не назначать</option>" : "";

  for (const assignee of state.users) {
    const assigneeLocationIds = new Set(assignee.locations.map((location) => location.id));
    let canAssign = false;

    if (user.role === "module_director") {
      canAssign = assignee.role === "director";
    } else if (user.role === "director") {
      canAssign = assignee.role === "owner";
    } else if (user.role === "owner") {
      canAssign = assignee.role === "manager" && assigneeLocationIds.has(selectedLocationId);
    } else if (user.role === "manager") {
      canAssign = assignee.id === user.id;
    } else {
      canAssign = assignee.locations.some((location) => allowedLocationIds.has(location.id));
    }

    if (!canAssign) {
      continue;
    }

    const option = document.createElement("option");
    option.value = assignee.id;
    option.textContent = `${assignee.name} · ${roleLabel(assignee.role)}`;
    elements.taskAssigneeInput.appendChild(option);
  }

  const firstOption = elements.taskAssigneeInput.options[0];
  if (firstOption && !allowEmptyAssignee) {
    elements.taskAssigneeInput.value = firstOption.value;
  }

  if (user.role === "manager") {
    elements.taskAssigneeInput.value = String(user.id);
  }
}

async function submitTaskForm(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user) {
    return;
  }

  const payload = {
    title: elements.taskTitleInput.value.trim(),
    description: elements.taskDescriptionInput.value.trim(),
    location_id: isDirectorRole(user) ? null : Number(elements.taskLocationInput.value),
    author_id: user.id,
    assignee_id: elements.taskAssigneeInput.value ? Number(elements.taskAssigneeInput.value) : null,
    priority: elements.taskPriorityInput.value,
    due_at: elements.taskDueInput.value ? new Date(elements.taskDueInput.value).toISOString() : null,
    comment: elements.taskCommentInput.value.trim(),
  };

  try {
    await sendJson("/api/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    closeModal("task");
    await loadTasksForCurrentUser({ silent: true });
  } catch (error) {
    showFormError(elements.taskFormError, error.message);
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
  const user = getCurrentUser();
  const assignedTasks = getAssignedTasks(filteredTasks, user);
  const authoredTasks = getAuthoredTasks(filteredTasks, user);

  clearTaskContainers();

  for (const task of assignedTasks) {
    elements.assignedTasks.appendChild(createTaskCard(task));
  }

  for (const task of authoredTasks) {
    elements.authoredTasks.appendChild(createTaskCard(task));
  }

  elements.assignedSectionCount.textContent = String(assignedTasks.length);
  elements.authoredSectionCount.textContent = String(authoredTasks.length);
  elements.emptyState.classList.toggle("hidden", assignedTasks.length + authoredTasks.length > 0);
  elements.tasksSummary.textContent = getTasksSummary(assignedTasks.length + authoredTasks.length);
  renderCounters();
  updateSidebarFilterState();
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
  container.innerHTML = "";

  if (!user) {
    return;
  }

  for (const action of getAvailableActions(task, user)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `task-action${action.variant ? ` ${action.variant}` : ""}`;
    button.textContent = action.label;
    button.dataset.taskId = String(task.id);
    if (action.nextStatus) {
      button.dataset.nextStatus = action.nextStatus;
    }
    button.title = `Действие для задачи #${task.id}`;
    button.addEventListener("click", () => {
      if (action.kind === "delete") {
        deleteTask(task);
      } else {
        openStatusModal(task, action);
      }
    });
    container.appendChild(button);
  }
}

function getAvailableActions(task, user) {
  const isGlobalUser = isGlobalRole(user);
  const isAssignee = task.assignee?.id === user.id;
  const isAuthor = task.author?.id === user.id;

  if (isAssignee && task.status === "Новая") {
    return [{ label: "В работу", nextStatus: "В работе" }];
  }

  if (isAssignee && task.status === "В работе") {
    return [{ label: "На проверку", nextStatus: "На проверке", variant: "primary" }];
  }

  if ((isGlobalUser || isAuthor) && task.status === "На проверке") {
    return [
      { label: "Задача выполнена", nextStatus: "Выполнена", variant: "primary" },
      { label: "Вернуть в работу", nextStatus: "В работе" },
      { label: "Задача отклонена", nextStatus: "Отменена", variant: "danger" },
    ];
  }

  const actions = [];
  if (isAuthor && ["Выполнена", "Отменена"].includes(task.status)) {
    actions.push({ label: "Удалить", kind: "delete", variant: "danger" });
  }
  return actions;
}

async function deleteTask(task) {
  const user = getCurrentUser();
  if (!user) {
    return;
  }

  const confirmed = window.confirm(`Удалить задачу #${task.id} "${task.title}"?`);
  if (!confirmed) {
    return;
  }

  try {
    await sendJson(`/api/tasks/${task.id}?user_id=${user.id}`, {
      method: "DELETE",
    });
    await loadTasksForCurrentUser({ silent: true });
  } catch (error) {
    window.alert(error.message);
  }
}

function openStatusModal(task, action) {
  hideFormError(elements.statusFormError);
  elements.statusTaskId.value = String(task.id);
  elements.statusNextValue.value = action.nextStatus;
  elements.statusCommentInput.value = task.comment || "";
  document.querySelector("#status-modal-title").textContent = `${action.label}: #${task.id}`;
  elements.statusModal.classList.remove("hidden");
  elements.statusCommentInput.focus();
}

async function submitStatusForm(event) {
  event.preventDefault();
  const taskId = elements.statusTaskId.value;
  const status = elements.statusNextValue.value;
  const comment = elements.statusCommentInput.value.trim();

  try {
    await sendJson(`/api/tasks/${taskId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, comment }),
    });
    closeModal("status");
    await loadTasksForCurrentUser({ silent: true });
  } catch (error) {
    showFormError(elements.statusFormError, error.message);
  }
}

function closeModal(name) {
  if (name === "task") {
    elements.taskModal.classList.add("hidden");
  }

  if (name === "status") {
    elements.statusModal.classList.add("hidden");
  }
}

function showFormError(element, message) {
  element.textContent = message;
  element.classList.remove("hidden");
}

function hideFormError(element) {
  element.textContent = "";
  element.classList.add("hidden");
}

function getFilteredTasks() {
  const query = elements.taskSearch.value.trim().toLowerCase();
  const status = elements.statusFilter.value;
  const priority = elements.priorityFilter.value;
  const locationId = state.selectedLocationId;

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
      && (!priority || task.priority === priority)
      && (!locationId || task.location?.id === locationId);
  });
}

function getBoardBaseTasks() {
  const user = getCurrentUser();
  if (!user) {
    return [];
  }

  const locationId = state.selectedLocationId;
  return state.tasks.filter((task) => {
    const belongsToBoard = task.assignee?.id === user.id || task.author?.id === user.id;
    return belongsToBoard && (!locationId || task.location?.id === locationId);
  });
}

function getAssignedTasks(tasks, user) {
  if (!user) {
    return [];
  }
  return tasks.filter((task) => task.assignee?.id === user.id);
}

function getAuthoredTasks(tasks, user) {
  if (!user) {
    return [];
  }
  return tasks.filter((task) => task.author?.id === user.id);
}

function clearTaskContainers() {
  elements.assignedTasks.innerHTML = "";
  elements.authoredTasks.innerHTML = "";
}

function renderCounters() {
  const boardTasks = getBoardBaseTasks();
  elements.counterAll.textContent = String(boardTasks.length);
  elements.counterNew.textContent = String(countTasksByStatus("Новая", boardTasks));
  elements.counterProgress.textContent = String(countTasksByStatus("В работе", boardTasks));
  elements.counterOverdue.textContent = String(countTasksByStatus("Просрочена", boardTasks));
  elements.counterReview.textContent = String(countTasksByStatus("На проверке", boardTasks));
  elements.counterDone.textContent = String(countTasksByStatus("Выполнена", boardTasks));
}

function updateSidebarFilterState() {
  for (const button of elements.sidebarFilterButtons) {
    button.classList.toggle("active", button.dataset.statusFilter === elements.statusFilter.value);
  }
}

function findUserByKnownCode(code) {
  const knownCodes = {
    "1000": "director",
    "1500": "module_director",
    "2000": "owner",
    "2101": "Менеджер Биг Бен",
    "2202": "Менеджер Аксон",
    "2303": "Менеджер Лагерная",
  };
  const expected = knownCodes[code];
  if (!expected) {
    return null;
  }
  return state.users.find((user) => user.role === expected || user.name === expected) ?? null;
}

function renderLoadError() {
  elements.userSelect.innerHTML = "<option>Ошибка загрузки</option>";
  elements.currentRole.textContent = "Проверьте, запущен ли сервер FastAPI";
  elements.locationsList.innerHTML = "<li class=\"error-text\">API недоступен</li>";
  elements.locationsCount.textContent = "0";
  elements.tasksSummary.textContent = "API недоступен";
}

function countTasksByStatus(status, tasks = state.tasks) {
  return tasks.filter((task) => task.status === status).length;
}

function getTasksSummary(count) {
  const user = getCurrentUser();
  const suffix = user ? `для ${user.name}` : "";
  const location = state.locations.find((item) => item.id === state.selectedLocationId);
  const locationPart = location ? `, заведение: ${location.name}` : "";
  return `${count} задач ${suffix}${locationPart}`.trim();
}

function getCurrentUser() {
  return state.users.find((item) => item.id === state.currentUserId);
}

function roleLabel(role) {
  const labels = {
    director: "Директор розницы",
    module_director: "Генеральный директор",
    owner: "Управляющей модуля",
    manager: "Менеджер",
  };
  return labels[role] ?? role;
}

function isGlobalRole(user) {
  return isDirectorRole(user) || user?.role === "owner";
}

function isDirectorRole(user) {
  return user?.role === "director" || user?.role === "module_director";
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
