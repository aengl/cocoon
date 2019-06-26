module.exports = {
  FilterAndSort: {
    in: {
      data: {
        required: true,
      },
      filter: {
        hide: true,
      },
      orderBy: {
        hide: true,
      },
    },

    out: {
      data: {},
    },

    async process(context) {
      const { data, filter, orderBy } = context.ports.read();
      const { data: filteredData } = await context.processTemporaryNode(
        'FilterCustom',
        {
          data,
          filter,
        }
      );
      const { data: sortedData } = await context.processTemporaryNode('Sort', {
        data: filteredData,
        orderBy,
      });
      context.ports.write({ data: sortedData });
      return `${sortedData.length} sorted items remaining`;
    },
  },
};
