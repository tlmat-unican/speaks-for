#!/usr/bin/env node

var fs = require('fs');
var _ = require('lodash');
var forge = require('node-forge');
var xmlcrypto = require('xml-crypto');
var pd = require('pretty-data').pd;

var utils = require('./utils');

var singleDayMillis = 86400000;
var yargs = require('yargs');
var argv = yargs
    .usage('Usage: $0 -c <file-path> -f <p12|pem> -p <password> -t <file-path> -d <int> -o <file-path>')
    .example('$0 -c user123.p12 -f p12 -p 123456 -t yourepm.pem', 'Generate a speaks-for credential which delegates access to YourEPM tool during 120 days. In this case the signing credential is a PKCS#12 container')
    .example('$0 --credential user123.pem --format pem --password 123456 --toolcertificate yourepm.pem --duration 365', 'The Fed4FIRE user credential is PEM formatted, and access is delegated during 1 year')
    .example('$0 -vv -c user123.pem -f pem -p 123456 -t yourepm.pem -d 365 -o s4cred.base64', 'Same command as previous one, but with DEBUG verbosity and storing the result on an output file')
    .options({
        'c': {
            alias: 'credential',
            required: true,
            nargs: 1,
            description: "User credential file path",
            group: 'Signing User'
        },
        'f': {
            alias: 'format',
            required: true,
            choices: ['pem', 'p12'],
            description: "Provided credential container format",
            group: 'Signing User'
        },
        'p': {
            alias: 'password',
            required: false,
            nargs: 1,
            default: "",
            description: "User credential password (only for encrypted credentials)",
            group: 'Signing User'
        },
        't': {
            alias: ['tc', 'toolcertificate'],
            required: true,
            nargs: 1,
            description: "Tool certificate file path",
            group: 'Speaks-for Parameters'
        },
        'd': {
            alias: ['days', 'duration'],
            required: false,
            nargs: 1,
            default: 120,
            description: "Number of days the speaks-for credential will be valid",
            group: 'Speaks-for Parameters'
        },
        'o': {
            alias: 'output',
            required: false,
            nargs: 1,
            description: "Output file to store speaks-for credential (base64 encoded)"
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
    // Load user credential
    INFO("## Loading user credential...");
    var userCredential = null;
    if (argv.format === 'pem') {
        userCredential = loadPemCredential(argv.credential, argv.password);
    } else if (argv.format === 'p12') {
        userCredential = loadPkcs12Credential(argv.credential, argv.password);
    }
    var userKeyhash = forge.pki.getPublicKeyFingerprint(userCredential.certChain[0].publicKey, {
        encoding: 'hex'
    });
    printCredentialEntryInfo(userCredential, DEBUG);
    INFO("## User certificate keyhash: %s", userKeyhash);

    // Load tool certificate
    INFO("## Loading tool certificate...");
    var toolCertificate = loadPemCertificate(argv.toolcertificate);
    var toolKeyhash = forge.pki.getPublicKeyFingerprint(toolCertificate.publicKey, {
        encoding: 'hex'
    });
    INFO("## Tool certificate keyhash: %s", toolKeyhash);


    // Calculate expiration time
    var timeOffset = argv.days * singleDayMillis;
    var expireDate = new Date();
    expireDate.setTime(expireDate.getTime() + timeOffset);

    // Load credential template file and generate the XML
    credentialTemplate = _.template(fs.readFileSync(require('path').resolve(__dirname, 'resources', 'credential-template.txt'), "utf8"));
    xml = credentialTemplate({
        'expires': expireDate.toISOString(),
        'userKeyhash': userKeyhash,
        'toolKeyhash': toolKeyhash
    });
    var toolPublicId = extractFed4FIREPublicId(toolCertificate);
    WARN("## Speaks-for credential will be delegated to [%s] tool until %s", toolPublicId, expireDate.toISOString());
    DEBUG("\n## XML Template to be signed:\n%s", _.trim(xml, ' \n'));

    utils.monkeyPatchSignedXmlExclusiveCanonicalization(xmlcrypto);
    var signedXml = new xmlcrypto.SignedXml(null, {
        idAttribute: "id"
    });
    signedXml.addReference("/*/*[local-name(.)='credential']");
    signedXml.signingKey = forge.pki.privateKeyToPem(userCredential.privateKey);
    signedXml.keyInfoProvider = new SpeaksForKeyInfo(userCredential.certChain);
    signedXml.computeSignature(xml, {
        location: {
            reference: "/*/*[local-name(.)='signatures']"
        }
    });
    var speaksForCredential = signedXml.getSignedXml();
    var speaksForCredential64 = new Buffer(speaksForCredential).toString('base64');
    INFO("\n## Resulting Speaks-for credential (formatted for display, which may invalidate the signature):\n%s", pd.xml(speaksForCredential));
    WARN("\n## Resulting Speaks-for credential (base64 encoded, %d bytes):\n%s", speaksForCredential64.length, speaksForCredential64);
    if (argv.output) {
        fs.writeFileSync(argv.output, speaksForCredential64);
        WARN("\n## Speaks-for credential (base64 encoded) written to file %s", argv.output);
    }
} catch (error) {
    WARN("## ERROR: %s", error);
    return;
}

function extractFed4FIREPublicId(cert) {
    var subjectAltName = cert.getExtension({
        name: 'subjectAltName'
    });
    var publicId = null;
    _.forEach(subjectAltName.altNames, function(item) {
        if (item.type === 6 && item.value.substr(0, 12) === 'urn:publicid') {
            publicId = item.value;
            return false;
        }
        return true;
    });
    return publicId;
}

function loadPemCertificate(pemfile) {
    var bitmap = fs.readFileSync(pemfile);
    var pem = new Buffer(bitmap).toString();

    return forge.pki.certificateFromPem(pem);
}

function loadPkcs12Credential(pkcs12file, password) {
    var bitmap = fs.readFileSync(pkcs12file);
    var pkcs12Der = new Buffer(bitmap).toString('binary');
    var pkcs12Asn1 = forge.asn1.fromDer(pkcs12Der);
    var pkcs12 = forge.pkcs12.pkcs12FromAsn1(pkcs12Asn1, false, password);

    // load keypair and cert chain from safe content(s). If there's more than one key ID stored on the container, then raise an error
    var p12contents = {
        privateKey: null,
        certChain: []
    };
    var keyId = null;
    for (var sci = 0; sci < pkcs12.safeContents.length; ++sci) {
        var safeContents = pkcs12.safeContents[sci];
        for (var sbi = 0; sbi < safeContents.safeBags.length; ++sbi) {
            var safeBag = safeContents.safeBags[sbi];
            var localKeyId = null;
            if (safeBag.attributes.localKeyId) {
                localKeyId = forge.util.bytesToHex(safeBag.attributes.localKeyId[0]);
                if (!keyId) {
                    keyId = localKeyId
                } else if (keyId != localKeyId) {
                    throw "PKCS#12 credential can only contain one single key ID"
                }
            } else {
                // no local key ID, skip bag
                continue;
            }

            if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag) {
                // this bag has a private key
                DEBUG("## New private key found");
                p12contents.privateKey = safeBag.key;
            } else if (safeBag.type === forge.pki.oids.certBag) {
                // this bag has a certificate
                DEBUG("## New certificate found");
                p12contents.certChain.push(safeBag.cert);
            }
        }
    }
    return p12contents;
}

function loadPemCredential(pemfile, password) {
    var bitmap = fs.readFileSync(pemfile);
    var pem = new Buffer(bitmap).toString();

    var pemContents = {
        privateKey: null,
        certChain: []
    };

    pemContents.privateKey = extractPrivateKeyFromPem(pem, password);
    pemContents.certChain = extractCertificateChainFromPem(pem);
    return pemContents;
}

function extractPrivateKeyFromPem(pem, password) {
    var pkcs5_header = "-----BEGIN RSA PRIVATE KEY-----";
    var pkcs5encrypted_subheader = "Proc-Type: 4,ENCRYPTED";
    var pkcs5_footer = "-----END RSA PRIVATE KEY-----";
    var pkcs8plain_header = "-----BEGIN PRIVATE KEY-----";
    var pkcs8plain_footer = "-----END PRIVATE KEY-----";
    var pkcs8encrypted_header = "-----BEGIN ENCRYPTED PRIVATE KEY-----";
    var pkcs8encrypted_footer = "-----END ENCRYPTED PRIVATE KEY-----";

    var privateKey = null;
    var aux = readPemCredentialElement(pem, pkcs5_header, pkcs5_footer);
    if (aux) {
        if (aux.length > 1 || privateKey) {
            throw "PEM credential can only contain one privateKey";
        } else {
            if (_.startsWith(aux[0], pkcs5encrypted_subheader, pkcs5_header.length + 1)) {
                // PKCS#5 encrypted key
                if (password) privateKey = forge.pki.decryptRsaPrivateKey(aux[0], password);
                if (!privateKey) throw new Error("Private key decryption failed. Invalid password?");
            } else {
                // PKCS#5 plain key
                privateKey = forge.pki.privateKeyFromPem(aux[0]);
            }
        }
    }

    aux = readPemCredentialElement(pem, pkcs8plain_header, pkcs8plain_footer);
    if (aux) {
        if (aux.length > 1 || privateKey) {
            throw "PEM credential can only contain one privateKey";
        } else {
            // PKCS#8 plain key
            privateKey = forge.pki.privateKeyFromPem(aux[0]);
        }
    }

    aux = readPemCredentialElement(pem, pkcs8encrypted_header, pkcs8encrypted_footer);
    if (aux) {
        if (aux.length > 1 || privateKey) {
            throw "PEM credential can only contain one privateKey";
        } else {
            // PKCS#8 encrypted key
            if (password) privateKey = forge.pki.decryptRsaPrivateKey(aux[0], password);
            if (!privateKey) throw new Error("Private key decryption failed. Invalid password?");
        }
    }
    DEBUG("## New private key found");
    return privateKey;
}

function extractCertificateChainFromPem(pem) {
    var certificate_header = "-----BEGIN CERTIFICATE-----";
    var certificate_footer = "-----END CERTIFICATE-----";

    var certificateChainPem = readPemCredentialElement(pem, certificate_header, certificate_footer);
    var certificateChain = [];
    _.forEach(certificateChainPem, function(pem) {
        DEBUG("## New certificate found");
        certificateChain.push(forge.pki.certificateFromPem(pem))
    });
    return certificateChain;
}

function readPemCredentialElement(pem, header, footer) {
    return pem.match(new RegExp(header + "([\\s\\S]*?)" + footer, 'g'));
}

function printCredentialEntryInfo(cred, level) {
    level('\n## Private Key:');
    level(_.trim(forge.pki.privateKeyToPem(cred.privateKey), ' \n'));
    level('\n## Certificate chain:');
    _.forEach(cred.certChain, function(cert) {
        level(_.trim(forge.pki.certificateToPem(cert), ' \n'));
    });
    level("")
}

/**
 * Populate the KeyInfo block in the signature. Add a KeyValue block
 * with the signing public key info (modulus and exponent). Put the
 * full certificate chain in the X509Data block so that it can be
 * verified.
 *
 * @param chain an one or more certificates in an array where the
 *              first is the signing certificate.
 */
function SpeaksForKeyInfo(chain) {
    this.chain = chain;

    /**
     * Note: This is a private function from forge.rsa
     * Converts a positive BigInteger into 2's-complement big-endian bytes.
     *
     * @param b the big integer to convert.
     *
     * @return the bytes.
     */
    this.bnToBytes = function(b) {
        // prepend 0x00 if first byte >= 0x80
        var hex = b.toString(16);
        if (hex[0] >= '8') {
            hex = '00' + hex;
        }
        return forge.util.binary.hex.decode(hex);
    }

    this.keyValue = function(cert) {
        var modulus = cert.publicKey.n;
        var exponent = cert.publicKey.e;
        var modulus64 = forge.util.binary.base64.encode(this.bnToBytes(modulus), 64);
        var exponent64 = forge.util.binary.base64.encode(this.bnToBytes(exponent), 64);
        // forge puts CR and NL in, we just want NL
        modulus64 = modulus64.replace(/\r\n/g, "\n");
        exponent64 = exponent64.replace(/\r\n/g, "\n");
        return "<KeyValue><RSAKeyValue><Modulus>" + modulus64 + "</Modulus><Exponent>" + exponent64 + "</Exponent></RSAKeyValue></KeyValue>";
    }

    this.getKeyInfo = function(key) {
        var result = "";
        if (this.chain) {
            result += this.keyValue(this.chain[0]);
            result += "<X509Data>";
            _.forEach(this.chain, function(cert) {
                var pemCert = forge.pki.certificateToPem(cert);
                // forge puts CR and NL in, we just want NL
                pemCert = pemCert.replace(/\r\n/g, "\n")
                result += "<X509Certificate>" + this.filterPemCertificate(pemCert) + "</X509Certificate>";
            }, this);
            result += "</X509Data>";
        }
        return result.replace(/\n$/, "");
    }

    this.filterPemCertificate = function(pemCert) {
        var result = "";
        _.forEach(pemCert.split("\n"), function(line) {
            if (line.length > 0 && !_.startsWith(line, '-----')) {
                result += line + "\n";
            }
        });
        return _.trim(result, ' \n');
    }
}