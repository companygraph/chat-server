// One line per event, on standard output or standard error, as one JSON object. Its first two
// keys are Cloud Logging's: it lifts `severity` into the entry's own and the labels into the
// entry's labels, so a reader filters a kind of line in the console by labels.logger, the way a
// logger's name is filtered elsewhere. The loggers are chat.question for the kept question,
// chat.start for the service coming up, chat.error for a fault while answering and chat.index
// for a title the question index had to leave out. The fields after the head are the line's
// own, and a payload reader such as the sink or the report sees only those.
//
// That is Google's form and the default. The plain form writes the logger as a top-level key
// beside the severity, which is what a platform without Cloud Logging's conventions, Azure's Log
// Analytics among them, reads as a column. The process chooses once, at start, from CHAT_LOG.

export const LOG_FORMATS = {
  google: (logger, severity, fields) => ({ severity, "logging.googleapis.com/labels": { logger }, ...fields }),
  plain: (logger, severity, fields) => ({ severity, logger, ...fields }),
};

export const formatLine = (kind, logger, severity, fields) => JSON.stringify(LOG_FORMATS[kind](logger, severity, fields));

let current = "google";

export const useLogFormat = (kind) => {
  if (!Object.hasOwn(LOG_FORMATS, kind)) throw new Error(`CHAT_LOG is not one of ${Object.keys(LOG_FORMATS).join(" ")}: ${kind}`);
  current = kind;
};

export const line = (logger, severity, fields) => formatLine(current, logger, severity, fields);
