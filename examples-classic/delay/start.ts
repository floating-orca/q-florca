import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  _requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  return {
    payload: [1, 2, 3],

    // next: {
    //   map: {
    //     fn: "plusOne",
    //     reduce: "sum",
    //   },
    // },

    next: {
      delay: {
        fn: {
          map: {
            fn: {
              delay: {
                fn: "plusOne",
              },
            },
            reduce: {
              delay: {
                fn: "sum",
              },
            },
          },
        },
      },
    },
  };
};
