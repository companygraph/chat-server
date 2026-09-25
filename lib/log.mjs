// One line per event, on standard output or standard error, as one JSON object. Its first two
// keys are Cloud Logging's: it lifts `severity` into the entry's own and the labels into the
// entry's labels, so a reader filters a kind of line in the console by labels.logger, the way a
// logger's name is filtered elsewhere. The loggers are chat.question for the kept question,
// chat.start for the service coming up, chat.error for a fault while answering and chat.index
// for a title the question index had to leave out. The fields after the head are the line's
// own, and a payload reader such as the sink or the report sees only those.
export const line = (logger, severity, fields) => JSON.stringify({ severity, "logging.googleapis.com/labels": { logger }, ...fields });
