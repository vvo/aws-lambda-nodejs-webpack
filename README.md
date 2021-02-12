# aws-lambda-nodejs-webpack ![npm](https://img.shields.io/npm/v/aws-lambda-nodejs-webpack) [![Mentioned in Awesome CDK](https://awesome.re/mentioned-badge.svg)](https://github.com/eladb/awesome-cdk) [![GitHub license](https://img.shields.io/github/license/vvo/aws-lambda-nodejs-webpack?style=flat)](https://github.com/vvo/aws-lambda-nodejs-webpack/blob/master/LICENSE) [![Tests](https://github.com/vvo/aws-lambda-nodejs-webpack/workflows/CI/badge.svg)](https://github.com/vvo/aws-lambda-nodejs-webpack/actions)

---

_[CDK](https://aws.amazon.com/cdk/) Construct to build Node.js AWS lambdas using [webpack](https://webpack.js.org/)_

_Table of contents:_

- [Usage example](#usage-example)
- [Features](#features)
- [Why?](#why)
- [Roadmap](#roadmap)
- [How to make changes and test locally](#how-to-make-changes-and-test-locally)
- [WTF happened to the rollup version?](#wtf-happened-to-the-rollup-version)
- [Thanks](#thanks)

## Usage example

```bash
yarn add aws-lambda-nodejs-webpack
```

```js
// infra/super-app-stack.js
const sns = require("@aws-cdk/aws-sns");
const subscriptions = require("@aws-cdk/aws-sns-subscriptions");
const core = require("@aws-cdk/core");
const { NodejsFunction } = require("aws-lambda-nodejs-webpack");

module.exports = class SuperAppProductionStack extends core.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const slackNotificationsLambda = new NodejsFunction(
      this,
      "slack-notifications-lambda",
      {
        entry: "events/slack-notifications.js", // required
      },
    );
  }
};
```

```js
// events/slack-notifications.js
import { WebClient as SlackWebClient } from "@slack/web-api";

export function handler(event) {
  const message = event.Records[0].Sns.Message;
  // do something with message
}
```

## Features

- webpack 5
- fast, [no-docker](https://github.com/aws/aws-cdk/issues/9120) CDK construct
- lambda output only contains the necessary files, no README, tests, ...
- bundling happens in temporary directories, it never writes in your project directory
- source map support
- TypeScript support
- Babel support (preset-env)
- babel & webpack caching
- node_modules are split into a single `vendor.js` file. Allowing you to debug your own code in AWS console most of the time

## Why?

There's already a dedicated [aws-lambda-nodejs module for CDK](https://docs.aws.amazon.com/cdk/api/latest/docs/aws-lambda-nodejs-readme.html) but I had two major issues with it:

1. **CDK uses docker** for anything lambda build related. This means it mounts your whole Node.js project (not just the lambda code) inside Docker before running a bundler like Parcel. This is perfectly fine and performant on Linux and Windows, but this is **extremely slow on macOS**: a single cdk synth would take 2 minutes for a 3 lines lambda. Since it might take a very long time for Docker on macOS to get as fast as on Linux. Even their latest update ([mutagen](https://docs.docker.com/docker-for-mac/mutagen/)), while significantly faster, still takes 20s just to mount a Node.js project.
2. aws-lambda-nodejs generates a single file bundle with every local and external module inlined. Which makes it very hard to debug and read on the AWS console. I wanted a lambda output that mimicks my project file organization.

I want to be clear: I respect a LOT the work of the CDK team, and especially [@jogold](https://github.com/jogold/), author of aws-lambda-nodejs) that helped me a lot into debugging performance issues and explaining to me how everything works.

## Caveats

⚠️ the only configuration file from your project that we will read is `tsconfig.json` (not including compilerOptions, which are overwritten using https://www.npmjs.com/package/@tsconfig/node12).

Other files won't be used (example: .babelrc). If you need to reuse part of your babel configuration, please open an issue with details on your usecase so we can build the best API for how to do this.

## How to make changes and test locally

```
// fork and clone
cd aws-lambda-nodejs-webpack
yarn
yarn link
yarn start

# in another terminal and project where you want to test changes
yarn link aws-lambda-nodejs-webpack
# cdk commands will now use your local aws-lambda-nodejs-webpack
```

## Thanks

- the CDK team for this awesome project
- [@jogold](https://github.com/jogold/) for his time while helping me debugging performance issues on Docker
