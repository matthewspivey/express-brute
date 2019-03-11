function fibonacci(min, max, freeRetries) {
  // build array of delays in a Fibonacci sequence, such as [1,1,2,3,5]
  const delays = [min];
  while (delays[delays.length - 1] < max) {
    const nextNum = delays[delays.length - 1] + (delays.length > 1 ? delays[delays.length - 2] : 0);
    delays.push(nextNum);
  }
  delays[delays.length - 1] = max;

  const getDelay = count => {
    const i = count - freeRetries - 1;
    if (i < 0) {
      return 0;
    }

    if (i >= delays.length) {
      return max;
    }

    return delays[i];
  };

  const defaultLifetime = Math.ceil((max / 1000) * (delays.length + freeRetries));

  return {
    delays,
    getDelay,
    defaultLifetime
  };
}

module.exports = {
  fibonacci
};
