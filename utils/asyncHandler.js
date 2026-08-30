// Express 4 doesn't catch rejections from async route handlers — an unguarded
// one crashes the whole process (Node's default unhandledRejection behavior),
// not just the request. Wrap a handler with this to forward the error to
// next(err) instead, where server.js's global error middleware turns it into
// a clean 500 JSON reply.
module.exports = function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
};
