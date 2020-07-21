import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { builtinModules } from "module";

export default {
  input: "events/slack-sync.js",
  output: {
    dir: "output",
    name: "coucou",
    format: "cjs",
    preserveModules: true,
    exports: "auto",
    sourcemap: "inline",
  },
  plugins: [
    nodeResolve({
      preferBuiltins: true,
    }),
    commonjs(),
    json(),
  ],
  external: ["aws-sdk", ...builtinModules],
};
