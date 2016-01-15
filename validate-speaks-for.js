#!/usr/bin/env node

var fs = require('fs');
var _ = require('lodash');
var xmlcrypto = require('xml-crypto');
var xsd = require('libxml-xsd');
var libxml = require('libxmljs-mt');
var forge = require('node-forge');
var Dom = require('xmldom').DOMParser;

var openssl = require('openssl-verify');
var utils = require('./utils');

var singleDayMillis = 86400000;
var yargs = require('yargs');
var argv = yargs
    .usage('Usage: $0 -s <file-path> -f <base64|xml> --ca <folder-path> -t <file-path>')
    .example('$0 -s s4cred.base64 -f base64', 'Validates a base64 encoded speaks-for credential using bundled CA')
    .example('$0 -s s4cred.base64 -f base64 --trustedCA ./ca', 'Validates a base64 encoded speaks-for credential selecting an specific CA folder')
    .example('$0 -v -s s4cred.xml -f xml', 'Validates an xml encoded speaks-for credential with extra verbosity level using bundled CA')
    .example('$0 -v -s s4cred.xml -f xml -t tool.cert', 'Same as before, but it also validates speaks-for tail section against tool certificate')
    .example('$0 -v -s s4cred.xml -f xml -k bf844ce5a5f21569c2d5c97d6d1a1c737b5670ab', 'Same as before, but speaks-for tail section validation is done against given keyid')
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
        'ca': {
            alias: ['trustedCA'],
            required: false,
            description: "Trusted CA's folder path",
            group: 'Speaks-for Parameters'
        },
        't': {
            alias: ['tc', 'toolcertificate'],
            required: false,
            nargs: 1,
            description: "Tool certificate file path to validate against Speaks-for credential tail section",
            group: 'Speaker Validation parameters'
        },
        'k': {
            alias: ['keyid', 'keyhash'],
            required: false,
            description: "Tool certificate keyhash to be checked against Speaks-for credential tail section",
            group: 'Speaker Validation parameters'
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

// Validate parameter exclusions
if (argv.keyhash && argv.toolcertificate) {
    WARN("## ERROR: Both speaker validation options (-k and -t) can't be used at the same time");
    return;
}

// Chdir to resources folder
var olddir = process.cwd();
process.chdir(require('path').resolve(__dirname, 'resources'));

// Load XSD schema
var xsdstr = fs.readFileSync('credential.xsd', "utf8");
var schema = xsd.parse(xsdstr);

// Resolve trusted CA folder
var trustedCaPath = (argv.trustedCA) ? argv.trustedCA : require('path').resolve(__dirname, 'resources/ca');
// Chdir to working folder
process.chdir(olddir);

// Load Speaks-for Credential
INFO("## Loading Speaks-for credential...");
var s4cred = loadSpeaksForCredential(argv.s4credential, argv.format === 'base64');
DEBUG("## Speaks-for credential content: \n%s\n", s4cred);
libxml.Document.fromXmlAsync(s4cred, {}, function(err, doc) {
    if (err) {
        WARN("## ERROR: %s", err);
        return;
    }
    // Validate document agains schema
    schema.validate(doc, function(err, validationErrors) {
        if (err) {
            WARN("## ERROR: %s", err);
            return;
        }
        // validationErrors is an array, null if the validation is ok
        if (validationErrors) {
            WARN("## ERROR: %s", validationErrors[0]);
            return;
        }
        INFO("## Stage 1. Supplied credential validates against the Speaks-for XSD schema");

        // Validate XML signature
        var credential = doc.get("/*/credential");
        var signature = doc.get("/*/signatures/*[local-name(.)='Signature' and namespace-uri(.)='http://www.w3.org/2000/09/xmldsig#']");
        utils.monkeyPatchSignedXmlExclusiveCanonicalization(xmlcrypto);
        var sig = new xmlcrypto.SignedXml(null, {
            idAttribute: "id"
        });
        sig.keyInfoProvider = new SpeaksForKeyInfo();
        sig.loadSignature(signature.toString());
        var res = sig.checkSignature(s4cred);
        if (!res) {
            WARN("## ERROR: %s", sig.validationErrors[0]);
            return;
        }
        INFO("## Stage 2. XML signature is valid per the XML-DSig standard");

        // Validate signing certificate
        var x509Node = signature.get("*[name()='KeyInfo']/*[name()='X509Data']");
        var x509Data = new Dom().parseFromString(x509Node.toString());
        var signingCertificatePem = sig.keyInfoProvider.getKey([x509Data]);

        // NOTE: Certificate chain validation is done by using OpenSSL command line calls (through openssl-verify package).
        // It can also be done with forge library, but according to [https://github.com/digitalbazaar/forge/blob/master/js/x509.js#L2873]
        // some checks are not yet implemented.
        openssl.verifyCertificate(signingCertificatePem, trustedCaPath, function(err, result) {
            var outputMessages = result.output.split('\n');
            if (!result.validCert) {
                WARN("## ERROR: %s", outputMessages[0]);
                return;
            } else {
                DEBUG("## The Speaks-for signing certificate is valid");
            }
            if (!result.verifiedCA) {
                WARN("## ERROR: Speaks-for signing certificate is not trusted. Reason: %s", outputMessages[1]);
                return;
            } else {
                DEBUG("## The Speaks-for signing certificate chain of trust has been verified");
            }
            if (result.expired) {
                WARN("## ERROR: Speaks-for signing certificate is not acceptable. Reason: %s", outputMessages[1]);
                return;
            }
            INFO("## Stage 3. The signing certificate is valid and trusted");

            var expirationDateStr = credential.get("expires").text();
            DEBUG("## Speaks-for expiration date: %s", expirationDateStr);
            if (new Date(expirationDateStr) < new Date()) {
                WARN("## ERROR: Speaks-for credential expired on %s", expirationDateStr);
                return;
            }
            INFO("## Stage 4. The expiration date has not passed");

            var signingCertificate = forge.pki.certificateFromPem(signingCertificatePem);
            var signingKeyhash = forge.pki.getPublicKeyFingerprint(signingCertificate.publicKey, {
                encoding: 'hex'
            });
            var credentialKeyhash = credential.get("abac//head//keyid").text();
            DEBUG("## Speaks-for credential head section keyhash: %s", credentialKeyhash);
            DEBUG("## Speaks-for credential signing cert keyhash: %s", signingKeyhash);
            if (signingKeyhash != credentialKeyhash) {
                WARN("## ERROR: The keyid of the Speaks-for credential head [%s] does not match the credential signer one [%s]", credentialKeyhash, signingKeyhash);
                return;
            }
            INFO("## Stage 5. The keyid of the head matches the credential signer (the SHA1 hash of the public key in the signing certificate)");

            if (argv.toolcertificate) {
                var toolKeyhash = credential.get("abac//tail//keyid").text();
                var cert = loadPemCertificate(argv.toolcertificate);
                var certKeyhash = forge.pki.getPublicKeyFingerprint(cert.publicKey, {
                    encoding: 'hex'
                });
                DEBUG("## Speaks-for credential tail section keyhash: %s", toolKeyhash);
                DEBUG("## Tool certificate keyhash (cli t parameter): %s", certKeyhash);
                if (certKeyhash != toolKeyhash) {
                    WARN("## ERROR: The keyid of the Speaks-for credential tail [%s] does not match the -t certificate one [%s]", toolKeyhash, argv.keyid);
                    return;
                }
                INFO("## Stage 6. The keyid of the tail matches the -t certificate one");
            } else if (argv.keyid) {
                var toolKeyhash = credential.get("abac//tail//keyid").text();
                DEBUG("## Speaks-for credential tail section keyhash: %s", toolKeyhash);
                DEBUG("## Tool certificate keyhash (cli k parameter): %s", argv.keyid);
                if (argv.keyid != toolKeyhash) {
                    WARN("## ERROR: The keyid of the Speaks-for credential tail [%s] does not match the -k parameter [%s]", toolKeyhash, argv.keyid);
                    return;
                }
                INFO("## Stage 6. The keyid of the tail matches the -k parameter");
            } else {
                WARN("## Verification of the Speaks-for credential tail section was not possible (no -k or -t parameter was included)");
            }
            WARN("## Speaks-for credential verification succeeded!!");
        });
    });
});

function loadSpeaksForCredential(s4credential, isBase64) {
    var bitmap = fs.readFileSync(s4credential, 'utf8');
    var speaksForCredential = new Buffer(bitmap, isBase64 ? 'base64' : 'utf8').toString();
    return speaksForCredential;
}

function loadPemCertificate(pemfile) {
    var bitmap = fs.readFileSync(pemfile);
    var pem = new Buffer(bitmap).toString();

    return forge.pki.certificateFromPem(pem);
}

function SpeaksForKeyInfo() {
    var certificate_header = "-----BEGIN CERTIFICATE-----";
    var certificate_footer = "-----END CERTIFICATE-----";

    this.wrapCertificate = function(cert) {
        return certificate_header + "\n" + _.trim(cert.replace(/\r\n/g, "\n"), ' \n') + "\n" + certificate_footer;
    }

    this.getKey = function(keyInfo) {
        var certificates = keyInfo[0].getElementsByTagName("X509Certificate");
        var pemChain = this.wrapCertificate(certificates[0].childNodes[0].nodeValue);
        for (var i = 1; i < certificates.length; i++) {
            pemChain += "\n" + this.wrapCertificate(certificates[i].childNodes[0].nodeValue);
        }
        return pemChain;
    }
}