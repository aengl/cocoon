# Snapshot report for `packages/cocoon/src/nodes/io/ReadJSON.test.ts`

The actual snapshot is saved in `ReadJSON.test.ts.snap`.

Generated by [AVA](https://ava.li).

## reads JSON from URI

> Snapshot 1

    {
      in: {
        uri: 'https://unpkg.com/@cocoon/cocoon@0.100.0/package.json',
      },
      out: {
        data: {
          author: 'Lynn Smeria <ae@cephea.de>',
          bin: {
            cocoon: 'dist/cocoon.js',
          },
          devDependencies: {
            '@cocoon/ipc': '0.100.0',
            '@cocoon/types': '0.100.0',
            '@cocoon/util': '0.100.0',
            '@types/debug': '4.1.4',
            '@types/got': '9.6.5',
            '@types/js-yaml': '3.12.1',
            '@types/json-stable-stringify': '1.0.32',
            '@types/lodash': '4.14.136',
            '@types/node': '12.6.8',
            '@types/webpack': '4.32.1',
            '@types/ws': '6.0.1',
            caporal: '1.3.0',
            debug: '4.1.1',
            got: '9.6.0',
            'js-yaml': '3.13.1',
            'json-stable-stringify': '1.0.1',
            lodash: '4.17.15',
            open: '6.4.0',
            'serialize-error': '4.1.0',
            'supports-color': '7.0.0',
            tmp: '0.1.0',
            'try-thread-sleep': '2.0.0',
            'type-fest': '0.6.0',
            typescript: '3.5.3',
            webpack: '4.38.0',
            'webpack-cli': '3.3.6',
          },
          engines: {
            node: '>=10',
          },
          files: [
            'dist/**/*',
          ],
          gitHead: 'a4ef7b8d59e1d70f2dedc063466d7d8eb14690d2',
          license: 'GPL-3.0-or-later',
          name: '@cocoon/cocoon',
          scripts: {
            'analyse-bundle': './analyse-bundle.sh',
            build: 'tsc && webpack',
            compile: 'tsc',
            dev: 'tsc --watch',
          },
          version: '0.100.0',
        },
      },
    }

## reads JSON from file

> Snapshot 1

    {
      in: {
        uri: '/Users/aen/Projects/cocoon2/packages/cocoon/tsconfig.json',
      },
      out: {
        data: {
          compilerOptions: {
            incremental: true,
          },
          extends: '../../tsconfig.json',
        },
      },
    }