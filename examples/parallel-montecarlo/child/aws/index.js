"use strict";

exports.handler = async ({ payload }) => {
  return { payload: payload + 1 };
};
