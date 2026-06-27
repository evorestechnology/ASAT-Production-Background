// Response formatting utilities
export const successResponse = (data, message = 'Success', statusCode = 200) => {
  return {
    success: true,
    message,
    data,
    statusCode
  };
};

export const errorResponse = (message, statusCode = 400, errors = null) => {
  return {
    success: false,
    message,
    errors,
    statusCode
  };
};

export const validationErrorResponse = (errors) => {
  return {
    success: false,
    message: 'Validation failed',
    errors,
    statusCode: 400
  };
};