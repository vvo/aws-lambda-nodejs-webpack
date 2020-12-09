import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as process from "process";
import * as spawn from "cross-spawn";
import findUp from "find-up";

import * as lambda from "@aws-cdk/aws-lambda";
import * as cdk from "@aws-cdk/core";

/**
 * Properties for a NodejsFunction
 */
export interface NodejsFunctionProps extends lambda.FunctionOptions {
  /**
   * Path to the entry file (JavaScript or TypeScript), relative to your project root
   */
  readonly entry: string;

  /**
   * The name of the exported handler in the entry file.
   *
   * @default "handler"
   */
  readonly handler?: string;

  /**
   * The runtime environment. Only runtimes of the Node.js family are
   * supported.
   *
   * @default - `NODEJS_12_X` if `process.versions.node` >= '12.0.0',
   * `NODEJS_10_X` otherwise.
   */
  readonly runtime?: lambda.Runtime;

  /**
   * If you get "Module not found: Error: Can't resolve 'module_name'" errors, and you're not
   * actually using those modules, then it means there's a module you're using that is trying to
   * dynamically require other modules. This is the case with Knex.js. When this happens, pass all the modules
   * names found in the build error in this array.
   *
   * Example if you're only using PostgreSQL with Knex.js, use:
   *  `modulesToIgnore: ["mssql", "pg-native", "pg-query-stream", "tedious"]`
   */
  readonly modulesToIgnore?: string[];

  /**
   * Whether to automatically reuse TCP connections when working with the AWS
   * SDK for JavaScript.
   *
   * This sets the `AWS_NODEJS_CONNECTION_REUSE_ENABLED` environment variable
   * to `1`.
   *
   * @see https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/node-reusing-connections.html
   *
   * @default true
   */
  readonly awsSdkConnectionReuse?: boolean;
}

/**
 * A Node.js Lambda function bundled using Parcel
 */
export class NodejsFunction extends lambda.Function {
  constructor(
    scope: cdk.Construct,
    id: string,
    props: NodejsFunctionProps = { entry: "" },
  ) {
    if (props.runtime && props.runtime.family !== lambda.RuntimeFamily.NODEJS) {
      throw new Error("Only `NODEJS` runtimes are supported.");
    }

    if (!/\.(js|ts)$/.test(props.entry)) {
      throw new Error(
        "Only JavaScript or TypeScript entry files are supported.",
      );
    }

    const entryFullPath = path.resolve(props.entry);

    if (!fs.existsSync(entryFullPath)) {
      throw new Error(`Cannot find entry file at ${entryFullPath}`);
    }

    const handler = props.handler ?? "handler";
    const defaultRunTime =
      nodeMajorVersion() >= 12
        ? lambda.Runtime.NODEJS_12_X
        : lambda.Runtime.NODEJS_10_X;
    const runtime = props.runtime ?? defaultRunTime;

    const outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "aws-lambda-nodejs-webpack"),
    );
    const webpackConfigPath = path.join(outputDir, "webpack.config.js");

    // The code below is mostly to handle cases where this module is used through
    // yarn link. I think otherwise just using require.resolve and passing just the babel plugin
    // names would have worked.

    const webpackBinPath = require.resolve("webpack-cli");

    const plugins = [
      "webpack",
      "babel-loader",
      "@babel/preset-env",
      "@babel/plugin-transform-runtime",
      "babel-plugin-source-map-support",
      "noop2",
    ];
    const pluginsPath = path.join(
      webpackBinPath.slice(0, webpackBinPath.lastIndexOf("/node_modules")),
      "node_modules",
    );
    const pluginsPaths: any = plugins.reduce(function(acc, pluginName) {
      return {
        [pluginName]: findUp.sync(pluginName, {
          type: "directory",
          cwd: pluginsPath,
        }),
        ...acc,
      };
    }, {});

    // NodeJs reserves '\' as an escape char; but pluginsPaths etc are inlined directly in the
    // TemplateString below, so will contain this escape character on paths computed when running
    // the Construct on a Windows machine, and so we need to escape these chars before writing them
    const escapePathForNodeJs = (path: string) => path.replace(/\\/g, '\\\\');

    const webpackConfiguration = `
    const { builtinModules } = require("module");
    const { NormalModuleReplacementPlugin } = require("${
      escapePathForNodeJs(pluginsPaths["webpack"])
    }");

    module.exports = {
      mode: "none",
      entry: "${escapePathForNodeJs(entryFullPath)}",
      target: "node",
      resolve: {
        modules: ["node_modules", "."],
        extensions: [ '.ts', '.js' ],
      },
      devtool: "source-map",
      module: {
        rules: [
          {
            test: /\\.js$/,
            exclude: /node_modules/,
            use: {
              loader: "${escapePathForNodeJs(pluginsPaths["babel-loader"])}",
              options: {
                cacheDirectory: true,
                presets: [
                  [
                    "${escapePathForNodeJs(pluginsPaths["@babel/preset-env"])}",
                    {
                      "targets": {
                        "node": "${
                          runtime.name.split("nodejs")[1].split(".")[0]
                        }"
                      },
                      loose: true,
                      bugfixes: true,
                    },
                  ]
                ],
                plugins: [
                  "${escapePathForNodeJs(pluginsPaths["@babel/plugin-transform-runtime"])}",
                  "${escapePathForNodeJs(pluginsPaths["babel-plugin-source-map-support"])}"
                ]
              }
            }
          },
          {
            test: /\\.ts$/,
            use: 'ts-loader',
            exclude: /node_modules/,
          },
        ]
      },
      externals: [...builtinModules, "aws-sdk"],
      output: {
        filename: "[name].js",
        path: "${escapePathForNodeJs(outputDir)}",
        libraryTarget: "commonjs2",
      },
      ${(props.modulesToIgnore &&
        `
      plugins: [
        new NormalModuleReplacementPlugin(
          /${escapePathForNodeJs(props.modulesToIgnore.join("|"))}/,
          "${escapePathForNodeJs(pluginsPaths["noop2"])}",
        ),
      ]
      `) ||
        ""}
    };`;

    fs.writeFileSync(webpackConfigPath, webpackConfiguration);

    // to implement cache, create a script that uses webpack API, store cache in a file with JSON.stringify, based on entry path key then reuse it
    const webpack = spawn.sync(webpackBinPath, ["--config", webpackConfigPath], {
      cwd: process.cwd(),
    });

    if (webpack.status !== 0) {
      console.error(`webpack had an error when bundling. Return status was ${webpack.status}`);
      console.error(
        webpack?.output?.map(out => {
          return out?.toString();
        }),
      );
      console.error("webpack configuration was:", webpackConfiguration);
      process.exit(1);
    }

    fs.unlinkSync(webpackConfigPath);

    super(scope, id, {
      ...props,
      runtime,
      code: lambda.Code.fromAsset(outputDir),
      handler: `main.${handler}`,
    });

    // Enable connection reuse for aws-sdk
    if (props.awsSdkConnectionReuse ?? true) {
      this.addEnvironment("AWS_NODEJS_CONNECTION_REUSE_ENABLED", "1");
    }

    this.addEnvironment("NODE_OPTIONS", "--enable-source-maps");
  }
}

function nodeMajorVersion(): number {
  return parseInt(process.versions.node.split(".")[0], 10);
}
