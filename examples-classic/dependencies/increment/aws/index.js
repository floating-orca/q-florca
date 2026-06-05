exports.handler = async (event) => {
  /** @type {number} */
  const payload = event.payload;
  return {
    payload: payload + 1,
  };
};
