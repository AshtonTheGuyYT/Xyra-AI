export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = status >= 500 ? 'Internal error' : err.message;
  if (status >= 500) console.error(err);
  if (res.headersSent) return;
  res.status(status).json({ error: message });
}

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}