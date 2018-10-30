import * as Debug from 'debug';
import { sendLog } from '../ipc';

function debug(namespace: string): (formatter: any, ...args: any[]) => void {
  const d = Debug.default(namespace);
  return (...x) => {
    sendLog({ namespace, args: x });
    d(...x);
  };
}

module.exports = debug;
export default debug;
