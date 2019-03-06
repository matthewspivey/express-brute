function setRetryAfter(res, nextValidRequestDate) {
  const secondUntilNextRequest = Math.ceil((nextValidRequestDate.getTime() - Date.now()) / 1000);
  res.header('Retry-After', secondUntilNextRequest);
}

function failTooManyRequests(req, res, next, nextValidRequestDate) {
  setRetryAfter(res, nextValidRequestDate);
  res.status(429);
  res.send({
    error: {
      text: 'Too many requests in this time frame.',
      nextValidRequestDate
    }
  });
}

function failForbidden(req, res, next, nextValidRequestDate) {
  setRetryAfter(res, nextValidRequestDate);
  res.status(403);
  res.send({
    error: {
      text: 'Too many requests in this time frame.',
      nextValidRequestDate
    }
  });
}

function failMark(req, res, next, nextValidRequestDate) {
  res.status(429);
  setRetryAfter(res, nextValidRequestDate);
  res.nextValidRequestDate = nextValidRequestDate;
  next();
}

module.exports = {
  failTooManyRequests,
  failForbidden,
  failMark
};
