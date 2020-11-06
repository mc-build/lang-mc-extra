const fs = require("fs");
const path = require("path");
const File = require("!io/File");
const CONFIG = require("!config/mc-extra");
const CompilerError = require("!errors/CompilerError");
const logger = require("!logger");
const mc = require("!lang/mc");
const tagLoopup = {
  blocks: "blocks",
  entities: "entity_types",
  fluids: "fluids",
  functions: "functions",
  items: "items",
};
let state = {};

const evaluate = (line, token) => {
  try {
    return mc.transpiler.evaluators.code.evaluateCodeWithEnv(
      `return ${line}`,
      mc.getEnv()
    );
  } catch (e) {
    return true;
  }
};
function targetedJSONAction(trigger, getPath) {
  return {
    match: ({ token }) => token.startsWith(trigger),
    exec(_, tokens) {
      const _token = tokens.shift();
      const { token } = _token;
      const [, name] = token.split(/\s+/);
      const file = new File();
      file.setPath(getPath(mc.transpiler.evaluate_str(name), _));
      mc.transpiler.validate_next_destructive(tokens, "{");
      let count = 1;
      let content = ["{"];
      while (count && tokens.length) {
        const item = tokens.shift().token;
        content.push(mc.transpiler.evaluate_str(item));
        if (item === "{") count++;
        if (item === "}") count--;
      }
      try {
        file.setContents(JSON.stringify(JSON.parse(content.join(""))));
        file.confirm();
      } catch (e) {
        console.log(content.join(""));
        throw new CompilerError(e.message, _token.line);
      }
    },
  };
}
const tagConsumer = mc.transpiler.list({
  getToken: (list) => list[0],
  actions: [
    {
      match: ({ token }) => /^LOOP/.test(token),
      exec(file, tokens, tag) {
        const { token } = tokens.shift();
        mc.transpiler.consumer.Loop(file, token, tokens, tag, tagConsumer);
      },
    },
    {
      match: ({ token }) => /^!IF\(/.test(token),
      exec(file, tokens, tag) {
        const _token = tokens.shift();
        const { token } = _token;
        const condition = token.substr(4, token.length - 5);
        tokens.shift();
        mc.transpiler.validate_next_destructive(tokens, "{");
        if (evaluate(condition, _token)) {
          while (tokens[0].token != "}") {
            tagConsumer(file, tokens, tag);
          }
          mc.transpiler.validate_next_destructive(tokens, "}");
        } else {
          let count = 1;
          while (count && tokens.length) {
            let item = tokens.shift().token;
            if (item === "{") count++;
            if (item === "}") count--;
          }
        }
      },
    },
    {
      match: ({ token }) => /^!.+/.test(token),
      exec(file, tokens, tag) {
        const { token } = tokens[0];
        const condition = token.substr(1);
        tokens.shift();
        mc.transpiler.validate_next_destructive(tokens, "{");
        if (evaluate(condition)) {
          while (tokens[0].token != "}") {
            tagConsumer(file, tokens, tag);
          }
          mc.transpiler.validate_next_destructive(tokens, "}");
        } else {
          let count = 1;
          while (count && tokens.length) {
            let item = tokens.shift().token;
            if (item === "{") count++;
            if (item === "}") count--;
          }
        }
      },
    },
  ],
  def: (file, tokens, tag) => {
    const { token } = tokens.shift();
    tag.values.add(mc.transpiler.evaluate_str(token));
  },
});
module.exports = function MC_EXTRA(registry) {
  logger.info(
    `loading mc-extra in ${CONFIG.integrated ? "integration" : "file"} mode`
  );
  if (CONFIG.integrated === true) {
    const transpiler = mc.transpiler;
    const GenericConsumer = transpiler.consumer.Generic;
    const EntryConsumer = transpiler.consumer.EntryOp;
    GenericConsumer.addAction({
      match: ({ token }) => token.startsWith("tags"),
      exec(file, tokens, func) {
        const _token = tokens.shift();
        const { token } = _token;
        // tags bla add stone;
        const [, name, action, value] = token.split(/\s+/);
        switch (action) {
          case "add":
            try {
              state.tags[name].values.add(mc.transpiler.evaluate_str(value));
            } catch (e) {
              throw new CompilerError(
                `invalid tag name '${name}'!`,
                _token.line
              );
            }
            break;
          default:
            throw new CompilerError(
              `invalid tag action '${action}'`,
              _token.line
            );
        }
      },
    });
    EntryConsumer.addAction({
      match: ({ token }) =>
        /^(blocks|entities|fluids|functions|items)/.test(token),
      exec(file, tokens) {
        const { token } = tokens.shift();
        const [type, name, replace] = token.split(/\s+/);
        const tag = (state.tags[name] = {
          type: tagLoopup[type],
          replace: replace === "replace",
          values: new Set(),
          namespace: mc.getNamespace(),
        });
        mc.transpiler.validate_next_destructive(tokens, "{");
        while (tokens[0].token != "}") {
          tagConsumer(file, tokens, tag);
        }
        tokens.shift();
      },
    });
    EntryConsumer.addAction(
      targetedJSONAction("loot", (name) => {
        const namespace = mc.getNamespace();
        return path.resolve(
          process.cwd(),
          "data",
          namespace.namespace,
          "loot_tables",
          namespace.path + name + ".json"
        );
      })
    );
    EntryConsumer.addAction(
      targetedJSONAction("predicate", (name) => {
        const namespace = mc.getNamespace();
        return path.resolve(
          process.cwd(),
          "data",
          namespace.namespace,
          "predicates",
          namespace.path + name + ".json"
        );
      })
    );
    EntryConsumer.addAction(
      targetedJSONAction("recipe", (name) => {
        const namespace = mc.getNamespace();
        return path.resolve(
          process.cwd(),
          "data",
          namespace.namespace,
          "recipes",
          namespace.path + name + ".json"
        );
      })
    );
    EntryConsumer.addAction(
      targetedJSONAction("advancement", (name) => {
        const namespace = mc.getNamespace();
        return path.resolve(
          process.cwd(),
          "data",
          namespace.namespace,
          "advancements",
          namespace.path + name + ".json"
        );
      })
    );
    mc.on("start", (e) => {
      state = {
        tags: {},
      };
    });
    mc.on("end", (e) => {
      for (const name in state.tags) {
        const tag = state.tags[name];
        const file = new File();
        file.setPath(
          path.resolve(
            process.cwd(),
            "data",
            tag.namespace.namespace,
            "tags",
            tag.type,
            tag.namespace.path + name + ".json"
          )
        );
        file.setContents(
          JSON.stringify({
            replace: tag.replace,
            values: Array.from(tag.values),
          })
        );
        file.confirm();
      }
    });
  } else {
    const EntryOp = mc.transpiler.list({
      def: (file, tokens) => {
        throw new CompilerError(`unexpected token '${tokens[0].token}'`);
      },
      actions: [],
      getToken: (list) => list[0],
    });
    EntryOp.addAction({
      match: ({ token }) =>
        /^(blocks|entities|fluids|functions|items)/.test(token),
      exec(file, tokens) {
        const { token } = tokens.shift();
        const [type, name, replace] = token.split(/\s+/);
        const parts = path.win32
          .normalize(
            path.relative(
              path.resolve(process.cwd(), "src"),
              file.split(".")[0]
            )
          )
          .split("\\");
        const tag = (state.tags[name] = {
          type: tagLoopup[type],
          replace: replace === "replace",
          values: new Set(),
          namespace: {
            namespace: parts[0],
            path: parts.slice(1).join("/") + (parts.length > 1 ? "/" : ""),
          },
        });
        mc.transpiler.validate_next_destructive(tokens, "{");
        while (tokens[0].token != "}") {
          tagConsumer(file, tokens, tag);
        }
        tokens.shift();
      },
    });
    EntryOp.addAction(
      targetedJSONAction("loot", (name, file) => {
        const parts = path.win32
          .normalize(
            path.relative(
              path.resolve(process.cwd(), "src"),
              file.split(".")[0]
            )
          )
          .split("\\");
        return path.resolve(
          process.cwd(),
          "data",
          parts[0],
          "loot_tables",
          [...parts.splice(1), name].join("/") + ".json"
        );
      })
    );
    EntryOp.addAction(
      targetedJSONAction("predicate", (name, file) => {
        const namespace = mc.getNamespace();
        return path.resolve(
          process.cwd(),
          "data",
          namespace.namespace,
          "predicates",
          namespace.path + name + ".json"
        );
      })
    );
    EntryOp.addAction(
      targetedJSONAction("recipe", (name, file) => {
        const namespace = mc.getNamespace();
        return path.resolve(
          process.cwd(),
          "data",
          namespace.namespace,
          "recipes",
          namespace.path + name + ".json"
        );
      })
    );
    EntryOp.addAction(
      targetedJSONAction("advancement", (name, file) => {
        const namespace = mc.getNamespace();
        return path.resolve(
          process.cwd(),
          "data",
          namespace.namespace,
          "advancements",
          namespace.path + name + ".json"
        );
      })
    );
    const EntryConsumer = (file, tokens) => {
      while (tokens.length > 0) {
        EntryOp(file, tokens);
      }
    };
    registry.set(".mce", function (file) {
      if (fs.existsSync(file)) {
        state = {
          tags: {},
        };
        const tokens = mc.transpiler.tokenize(fs.readFileSync(file, "utf-8"));
        EntryConsumer(file, tokens);
        for (const name in state.tags) {
          const tag = state.tags[name];
          const file = new File();
          file.setPath(
            path.resolve(
              process.cwd(),
              "data",
              tag.namespace.namespace,
              "tags",
              tag.type,
              tag.namespace.path + name + ".json"
            )
          );
          file.setContents(
            JSON.stringify({
              replace: tag.replace,
              values: Array.from(tag.values),
            })
          );
          file.confirm();
        }
      }
    });
    logger.info(`registered handler or extension for '.mce'`);
  }
  return {
    exported: {},
  };
};
