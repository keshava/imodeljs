/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2017 Bentley Systems, Incorporated. All rights reserved. $
 *--------------------------------------------------------------------------------------------*/
"use strict";

const chalk = require("chalk");

exports.command = "test-e2e <type>";
exports.describe = chalk.bold("Launches the WebDriverIO end-to-end test runner.");
exports.builder = (yargs) =>
  yargs.strict(true)
    .positional("type", {
      choices: ["electron", "chrome", "headless"],
      describe: `The type of browser to run the test in.`,
      type: "string"
    });

exports.handler = async (argv) => {  

  // Do this as the first thing so that any code reading it knows the right env.
  require("./utils/initialize")("test-e2e");
  const path = require("path");
  const paths = require("../config/paths");
  const { spawn, handleInterrupts } = require("./utils/simpleSpawn");
  
  console.log("Cleaning " + paths.appTestE2ELib);
  await spawn("rimraf", [paths.appTestE2ELib]);
  
  console.log("Compiling TypeScript in " + paths.appTestE2E);
  const tscExitCode = await spawn("tsc", [], paths.appTestE2E);
  if (tscExitCode !== 0) {
    process.exit(tscExitCode);
  }

  console.log("Starting WebdriverIO E2E Tests...");
  const wdioArgs = [
    require.resolve("webdriverio/bin/wdio"),
    require.resolve(`../config/wdio/wdio.config.${argv.type}`)
  ];
  spawn("node", wdioArgs).then((code) =>  process.exit(code));

  handleInterrupts();
};
