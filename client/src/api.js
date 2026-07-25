import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('cw_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Personal cases
export const getCases      = (params) => api.get('/cases', { params }).then(r => r.data);
export const getCase       = (id) => api.get(`/cases/${id}`).then(r => r.data);
export const createCase    = (data) => api.post('/cases', data).then(r => r.data);
export const updateCase    = (id, data) => api.put(`/cases/${id}`, data).then(r => r.data);
export const deleteCase    = (id) => api.delete(`/cases/${id}`).then(r => r.data);
export const getFilters    = () => api.get('/filters').then(r => r.data);

// Auth
export const login = (data) => api.post('/auth/login', data).then(r => r.data);
export const getMe = () => api.get('/auth/me').then(r => r.data);

// Admin user management
export const createUsers  = (emails) => api.post('/admin/users', { emails }).then(r => r.data);
export const getUsers     = () => api.get('/admin/users').then(r => r.data);
export const deleteUser   = (id) => api.delete(`/admin/users/${id}`).then(r => r.data);

// Casebook
export const getCasebookCases   = (params) => api.get('/casebook/cases', { params }).then(r => r.data);
export const getCasebookCase    = (id) => api.get(`/casebook/cases/${id}`).then(r => r.data);
export const getCasebookFilters = () => api.get('/casebook/filters').then(r => r.data);
export const createCasebookCase = (data) => api.post('/casebook/cases', data).then(r => r.data);
export const updateCasebookCase = (id, data) => api.put(`/casebook/cases/${id}`, data).then(r => r.data);
export const deleteCasebookCase = (id) => api.delete(`/casebook/cases/${id}`).then(r => r.data);
export const patchNoteCategory  = (caseId, category, text) => api.patch(`/casebook/cases/${caseId}/notes/${category}`, { text }).then(r => r.data);
export const uploadDiagram      = (caseId, file) => { const fd = new FormData(); fd.append('image', file); return api.post(`/casebook/cases/${caseId}/diagram`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data); };
export const deleteDiagram      = (diagramId) => api.delete(`/casebook/diagrams/${diagramId}`).then(r => r.data);

// Progress (student)
export const getProgress        = () => api.get('/casebook/progress').then(r => r.data);
export const getCaseProgress    = (id) => api.get(`/casebook/cases/${id}/progress`).then(r => r.data);
export const updateProgress     = (id, data) => api.put(`/casebook/cases/${id}/progress`, data).then(r => r.data);
export const getReactions       = (id) => api.get(`/casebook/cases/${id}/reactions`).then(r => r.data);
export const updatePersonalNotes = (id, notes) => api.patch(`/casebook/cases/${id}/personal-notes`, { notes }).then(r => r.data);
