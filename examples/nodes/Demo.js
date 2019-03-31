module.exports = {
  DemoStep: {
    in: {
      progress: {
        hide: true
      }
    },

    out: {
      progress: {}
    },

    async process(context) {
      const { progress } = context.ports.readAll();
      context.ports.writeAll({ progress: progress ? progress + 1 : 1 });
      return `Done!`;
    }
  }
};
