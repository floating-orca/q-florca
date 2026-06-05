exports.handler = async (requestBody) => {
	const start = new Date();

	return {
		payload: {
			start: start,
			end: new Date(),
			result: {},
			id: requestBody.context.id
		},
		next: undefined,
	};
};
