#!/usr/bin/env node

var fs = require("fs");
var base64url = require('base64-url');

var yargs = require('yargs');
var argv = yargs
    .usage('Usage: $0 -s <file-path> -f <base64|xml> -o <file-path>')
    .example('$0 -s s4cred.base64 -f base64', 'Encodes a base64 encoded speaks-for credential into its urlsafe variant (RFC4648) and prints the result on the stdout')
    .example('$0 -s s4cred.xml -f xml -o s4cred.base64.urlsafe', 'Encodes an XML encoded speaks-for credential into a base64 urlsafe variant (RFC4648) and stores the result on a file')
    .options({
        's': {
            alias: 's4credential',
            required: true,
            nargs: 1,
            description: "Speaks-for credential file",
            group: 'Speaks-for Parameters'
        },
        'f': {
            alias: 'format',
            required: true,
            choices: ['base64', 'xml'],
            description: "Provided Speaks-for credential file format",
            group: 'Speaks-for Parameters'
        },
        'o': {
            alias: 'output',
            required: false,
            nargs: 1,
            description: "Output file to store speaks-for credential (base64 urlsafe encoded)"
        },
        'v': {
            alias: 'verbose',
            count: true,
            description: "Verbosity level (none, -v or -vv)"
        }
    })
    .help('h')
    .alias('h', 'help')
    .version(function() {
        return require('./package').version;
    })
    .epilog('Fed4FIRE - University of Cantabria - Copyright 2016')
    .strict()
    .wrap(yargs.terminalWidth())
    .argv;


var VERBOSE_LEVEL = argv.verbose;

function WARN() {
    VERBOSE_LEVEL >= 0 && console.log.apply(console, arguments);
}

function INFO() {
    VERBOSE_LEVEL >= 1 && console.log.apply(console, arguments);
}

function DEBUG() {
    VERBOSE_LEVEL >= 2 && console.log.apply(console, arguments);
}

try {
    // Load Speaks-for Credential
    INFO("## Loading Speaks-for credential...");
    var s4cred = loadSpeaksForCredential(argv.s4credential, argv.format === 'base64');
    DEBUG("## Speaks-for credential content: \n%s\n", s4cred);
    var s4cred_b64us = base64url.encode(s4cred);
    WARN("## Resulting Speaks-for credential (base64 urlsafe encoded, %d bytes):\n%s", s4cred_b64us.length, s4cred_b64us);
    if (argv.output) {
        fs.writeFileSync(argv.output, s4cred_b64us);
        WARN("\n## Speaks-for credential (base64 urlsafe encoded) written to file %s", argv.output);
    }
} catch (error) {
    WARN("## ERROR: %s", error);
    return;
}

function loadSpeaksForCredential(s4credential, isBase64) {
    var bitmap = fs.readFileSync(s4credential, 'utf8');
    var speaksForCredential = new Buffer(fs.readFileSync(s4credential, 'utf8'), isBase64 ? 'base64' : 'utf8').toString();
    return speaksForCredential;
}

