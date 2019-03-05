function fibonacci(min, max) {
  const delays = [min];
  while (delays[delays.length - 1] < max) {
    const nextNum = delays[delays.length - 1] + (delays.length > 1 ? delays[delays.length - 2] : 0);
    delays.push(nextNum);
  }
  delays[delays.length - 1] = max;
  return delays;
}

module.exports = {
  fibonacci
};
