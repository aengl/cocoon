/**
 * A Cocoon node is essentially a pure function wrapped in an object that
 * contains some meta information, exported using CommonJS (Cocoon will adopt
 * ES2015 exports once it rolls out in Node.JS).
 *
 * No library or API imports required! It's that simple.
 */

/**
 * Nodes can have their own dependencies: add them to this project's
 * package.json, install them, and `require` them like usual — the core's
 * project-node loader resolves them. (The legacy build bundled a handful of
 * deps like lodash "for free"; the revival deliberately does not — the core
 * is zero-dependency, so a node either stays dependency-free or owns its
 * deps explicitly. This node used `_.sample`; the one-liner below replaces
 * it, keeping the example installable with nothing at all.)
 */

/**
 * Note that it's necessary that nodes are named exports. The name of the export
 * determines the name of the node. The filename is irrelevant, and it's
 * possible to export multiple nodes from one file.
 */
module.exports.ExampleNode = {
  /**
   * The category is used to categorise nodes into groups (as seen in the
   * editor's context menu). This is optional.
   */
  category: 'Data',

  /**
   * Describes what the node does. Optional but highly recommended.
   */
  description: `A custom Cocoon node that picks a random item from the data, for demonstration purposes.`,

  /**
   * The input ports. This tells the editor what ports are available and can be
   * used to attach various meta information to the port.
   */
  in: {
    data: {
      description: `An array of data item objects.`,
    },
  },

  /**
   * Same as `in`, but for output ports.
   */
  out: {
    item: {
      description: `The randomly picked data item.`,
    },
  },

  /**
   * This is the most important part of the node. Like the name of the function
   * implies, this is where the actual data processing happens.
   *
   * The node receives a context object that contains the entire graph, the
   * node registry, port interface and various other things. It encapsulates the
   * entire state of Cocoon.
   *
   * It should always be an async generator function (`async *`), even when
   * await/yield is not used, but regular functions will work as well. We will
   * explore these concepts later in this example.
   *
   * If you want to have a look at the typings, see `CocoonNodeContext` at:
   * https://unpkg.com/@cocoon/types/dist/index.d.ts
   */
  async *process(context) {
    // Read the data from the input port. This just fetches a reference, so the
    // operation is cheap and fast.
    const { data } = context.ports.read();

    // Sample a random item (zero-dep replacement for lodash `_.sample`).
    const randomItem = data[Math.floor(Math.random() * data.length)];

    // Write the data to the output ports. Caches are created after the
    // processing finishes, so this is another cheap call at this point.
    context.ports.write({ item: randomItem });

    // Processing functions don't have to return anything, but can yield/return
    // either a string or an array of the form [string, number], the number
    // being the progress in percent (0 to 1). They're used to show visual
    // status and progress indicators in the editor.
    return `You should watch ${randomItem.title}!`;
  },
};
