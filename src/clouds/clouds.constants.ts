export const CLOUDS_CONSTANTS = {
  MONTH_LIMIT: {
    AMAZON: 900,
    GOOGLE: 900,
    AZURE: 900,
  },
  get LIMIT_MAP() {
    return {
      FIBONACCI: this.MONTH_LIMIT.AMAZON,
      PRIME: this.MONTH_LIMIT.GOOGLE,
      ARMSTRONG: this.MONTH_LIMIT.AZURE,
    };
  },
  limitedResponse: {
    success: false,
    message: 'no more free requests this month, try tomorrow',
  },
  MAX_WAIT_TIME: 60 * 60 * 1000, // 60 minutes
  ID_REGEX: /\w{2}(\d{1})\w{2}(\d{3})\w{2}(\d{3})\w{2}(\d{3})\w{2}(\d{3})\w{2}/,
};
