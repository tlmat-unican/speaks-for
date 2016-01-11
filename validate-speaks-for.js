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
    .usage('Usage: $0 -s <file-path>')
    .example('$0 -s s4cred.base64 -f base64', 'Validates a base64 encoded speaks-for credential using bundled CA')
    .example('$0 -s s4cred.base64 -f base64 -t ./ca', 'Validates a base64 encoded speaks-for credential selecting an specific CA folder')
    .example('$0 -v -s s4cred.xml -f xml', 'Validates an xml encoded speaks-for credential with extra verbosity level using bundled CA')
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
        't': {
            alias: ['trustedCA'],
            required: false,
            description: "Trusted CA's folder path",
            group: 'Speaks-for Parameters'
        },
        'v': {
            alias: 'verbose',
            count: true,
            description: "Verbosity level (none, -v or -vv)"
        }
    })
    .help('h')
    .alias('h', 'help')
    .version(1.0)
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

            // TODO: Should  Speaks-for credential tail fingerprint (tool keyid) should be checked against tool own certificate?

            WARN("## Speaks-for credential verification succeeded!!");
        });
    });
});

function loadSpeaksForCredential(s4credential, isBase64) {
    var bitmap = fs.readFileSync(s4credential, 'utf8');
    var speaksForCredential = new Buffer(bitmap, isBase64 ? 'base64' : 'utf8').toString();
    return speaksForCredential;
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