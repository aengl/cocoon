// const { Readable } = require('stream');

module.exports.Circle = {
  category: 'Data',

  in: {},

  out: {
    data: {},
  },

  async *process(context) {
    context.ports.write({
      data: [...new Array(100)].map((_, i) => ({
        x: Math.sin(i),
        y: Math.cos(i),
      })),
    });
    // let i = 0;
    // context.ports.write({
    //   data: new Readable({
    //     objectMode: true,
    //     read() {
    //       this.push(
    //         i < 1000
    //           ? {
    //               x: Math.sin(i),
    //               y: Math.cos(i),
    //             }
    //           : null
    //       );
    //       i += 1;
    //     },
    //   }),
    // });
  },
};
