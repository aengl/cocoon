module.exports = {
  DemoStep: {
    in: {
      progress: {
        hide: true,
      },
    },

    out: {
      progress: {},
    },

    async process(context) {
      const { progress } = context.ports.read();
      context.ports.write({ progress: progress ? progress + 1 : 1 });
      return `Done!`;
    },
  },
};
