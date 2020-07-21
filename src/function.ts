import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as lambda from "@aws-cdk/aws-lambda";
import * as cdk from "@aws-cdk/core";
import * as process from "process";
import { ParcelBaseOptions } from "./bundling";
import { spawnSync } from "child_process";

/**
 * Properties for a NodejsFunction
 */
export interface NodejsFunctionProps
  extends lambda.FunctionOptions,
    ParcelBaseOptions {
  /**
   * Path to the entry file (JavaScript or TypeScript).
   *
   * @default - Derived from the name of the defining file and the construct's id.
   * If the `NodejsFunction` is defined in `stack.ts` with `my-handler` as id
   * (`new NodejsFunction(this, 'my-handler')`), the construct will look at `stack.my-handler.ts`
   * and `stack.my-handler.js`.
   */
  readonly entry: string;

  /**
   * The name of the exported handler in the entry file.
   *
   * @default handler
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

    console.log(props.entry);

    if (!/\.(js|ts)$/.test(props.entry)) {
      throw new Error(
        "Only JavaScript or TypeScript entry files are supported.",
      );
    }

    const entry = path.resolve(props.entry);

    if (!fs.existsSync(entry)) {
      throw new Error(`Cannot find entry file at ${entry}`);
    }

    const handler = props.handler ?? "handler";
    const defaultRunTime =
      nodeMajorVersion() >= 12
        ? lambda.Runtime.NODEJS_12_X
        : lambda.Runtime.NODEJS_10_X;
    const runtime = props.runtime ?? defaultRunTime;

    const outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "aws-lambda-nodejs-rollup"),
    );
    const rollupConfigPath = path.join(outputDir, "rollup.config.js");
    fs.writeFileSync(
      rollupConfigPath,
      `import { nodeResolve } from "@rollup/plugin-node-resolve";
    import commonjs from "@rollup/plugin-commonjs";
    import json from "@rollup/plugin-json";
    import { builtinModules } from "module";

    export default {
      input: "${entry}",
      output: {
        dir: ${outputDir},
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
    `,
    );

    const rollup = spawnSync("./node_modules/.bin/rollup", [
      "-c",
      rollupConfigPath,
    ]);
    console.log(outputDir);
    console.log(rollup);

    super(scope, id, {
      ...props,
      runtime,
      code: lambda.Code.fromAsset(outputDir),
      // code: lambda.Code.fromAsset(projectRoot, {
      //   assetHashType: cdk.AssetHashType.BUNDLE,
      //   bundling: {
      //     image,
      //     command: ["bash", "-c", chain([parcelCommand, depsCommand])],
      //     environment: options.parcelEnvironment,
      //     volumes: options.cacheDir
      //       ? [{ containerPath: "/parcel-cache", hostPath: options.cacheDir }]
      //       : [],
      //     workingDirectory: path
      //       .dirname(containerEntryPath)
      //       .replace(/\\/g, "/"), // Always use POSIX paths in the container
      //   },
      // }),
      handler: `index.${handler}`,
    });

    // Enable connection reuse for aws-sdk
    if (props.awsSdkConnectionReuse ?? true) {
      this.addEnvironment("AWS_NODEJS_CONNECTION_REUSE_ENABLED", "1");
    }
  }
}

// function findEntry(entry: string): string {
//   if (!/\.(jsx?|tsx?)$/.test(entry)) {
//     throw new Error("Only JavaScript or TypeScript entry files are supported.");
//   }
//   if (!fs.existsSync(entry)) {
//     throw new Error(`Cannot find entry file at ${entry}`);
//   }
//   return entry;
// }

function nodeMajorVersion(): number {
  return parseInt(process.versions.node.split(".")[0], 10);
}
