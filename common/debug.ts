import Debug from 'debug';
import { isCoreProcess, isMainProcess, sendLog } from './ipc';

function debug(namespace: string): (formatter: any, ...args: any[]) => void {
  const d = Debug.default(namespace);
  return (...x) => {
    if (isMainProcess || isCoreProcess) {
      sendLog({ namespace, args: x });
    }
    d(...x);
  };
}

module.exports = debug;
export default debug;
