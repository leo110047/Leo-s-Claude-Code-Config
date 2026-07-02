#!/usr/bin/env node

import { main } from './lib/code-style/cli.mjs';

process.exitCode = main(process.argv.slice(2));
