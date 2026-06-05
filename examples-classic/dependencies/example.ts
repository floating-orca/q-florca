import type { PluginRequestBody, ResponseBody } from "@florca/fn";

type RequestPayload = number;

const plusOne = async (number: number) => {
  console.log(`plusOne(${number}): Calculating...`);
  await new Promise((resolve) => setTimeout(resolve, 10000 / (number + 1)));
  const result = number + 1;
  console.log(`plusOne(${number}) = ${result}`);
  return result;
};

const sum = async (i: number, x: Promise<number>, y?: Promise<number>) => {
  if (y) {
    console.log(`sum: Waiting for plusOne(${i}) and plusOne(${i - 1})`);
  } else {
    console.log(`sum: Waiting for plusOne(${i})`);
  }

  const actualX = await x;
  const actualY = y ? await y : 0;
  const result = actualX + actualY;

  if (y) {
    console.log(`sum: Sum of plusOne(${i}) and plusOne(${i - 1}) is ${result}`);
  } else {
    console.log(`sum: Sum of plusOne(${i}) is ${result}`);
  }

  return result;
};

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const n: RequestPayload = requestBody.payload;
  const numbers = [...Array(n).keys()]; // [0, 1, 2, ..., n - 1]
  const plusOnes = numbers.map(plusOne);
  const results = numbers.map((_, i) =>
    sum(i, plusOnes[i], i > 0 ? plusOnes[i - 1] : undefined)
  );
  return {
    payload: await Promise.all(results),
  };
};
