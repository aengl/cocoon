export interface LogArgs {
  additionalArgs: any[];
  namespace: string;
  message: string;
}

export default function(
  debug: import('debug').Debug,
  sendLog: (args: LogArgs) => void
) {
  const debugLog = debug.log;
  debug.log = function(this: any, message: string, ...args: any[]) {
    // tslint:disable-next-line:no-this-assignment
    const { namespace } = this;
    sendLog({
      additionalArgs: args.length > 1 ? args.slice(0, args.length - 1) : [],
      message: message
        .replace(/[\x00-\x1F\s]*\[([\d]+;?)+m(\w+:\w+)?/gm, '')
        .trim(),
      namespace,
    });
    // In the node console we suppress the `...args`
    return debugLog(message);
  };
}
