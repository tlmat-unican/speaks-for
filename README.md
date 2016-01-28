# Fed4FIRE Speaks-For credential management tools

## Installation
Just install Node.JS and run ```npm install -g speaks-for```. The tools have been tested on Ubuntu 14.04, but should also work on Windows and MacOS as well.

## Credential generation

```
Usage: speaks-for -c <file-path> -f <p12|pem> -p <password> -t <file-path> -d <int> -o <file-path>

Signing User
  -c, --credential  User credential file path                                                            [required]
  -f, --format      Provided credential container format                         [required] [choices: "pem", "p12"]
  -p, --password    User credential password (only for encrypted credentials)                         [default: ""]

Speaks-for Parameters
  -t, --tc, --toolcertificate  Tool certificate file path                                                [required]
  -d, --days, --duration       Number of days the speaks-for credential will be valid                [default: 120]

Options:
  -o, --output   Output file to store speaks-for credential (base64 encoded)
  -v, --verbose  Verbosity level (none, -v or -vv)                                                          [count]
  -h, --help     Show help                                                                                [boolean]
  --version      Show version number                                                                      [boolean]

Examples:
  speaks-for -c user123.p12 -f p12 -p 123456 -t yourepm.pem  Generate a speaks-for credential which delegates
                                                             access to YourEPM tool during 120 days. In this case
                                                             the signing credential is a PKCS#12 container
  speaks-for --credential user123.pem --format pem           The Fed4FIRE user credential is PEM formatted, and
  --password 123456 --toolcertificate yourepm.pem            access is delegated during 1 year
  --duration 365
  speaks-for -vv -c user123.p12 -f ppem -p 123456 -t         Same command as previous one, but with DEBUG verbosity
  yourepm.pem -d 365 -o s4cred.base64                        and storing the result on an output file

Fed4FIRE - University of Cantabria - Copyright 2016
```

## Credential validation

```
Usage: validate-speaks-for -s <file-path> -f <base64|xml> --ca <folder-path> -t <file-path>

Speaks-for Parameters
  -s, --s4credential  Speaks-for credential file                                                         [required]
  -f, --format        Provided Speaks-for credential file format              [required] [choices: "base64", "xml"]
  --ca, --trustedCA   Trusted CA's folder path

Speaker Validation parameters
  -t, --tc, --toolcertificate  Tool certificate file path to validate against Speaks-for credential tail section
  -k, --keyid, --keyhash       Tool certificate keyhash to be checked against Speaks-for credential tail section

Options:
  -v, --verbose  Verbosity level (none, -v or -vv)                                                          [count]
  -h, --help     Show help                                                                                [boolean]
  --version      Show version number                                                                      [boolean]

Examples:
  validate-speaks-for -s s4cred.base64 -f base64             Validates a base64 encoded speaks-for credential using
                                                             bundled CA
  validate-speaks-for -s s4cred.base64 -f base64             Validates a base64 encoded speaks-for credential
  --trustedCA ./ca                                           selecting an specific CA folder
  validate-speaks-for -v -s s4cred.xml -f xml                Validates an xml encoded speaks-for credential with
                                                             extra verbosity level using bundled CA
  validate-speaks-for -v -s s4cred.xml -f xml -t tool.cert   Same as before, but it also validates speaks-for tail
                                                             section against tool certificate
  validate-speaks-for -v -s s4cred.xml -f xml -k             Same as before, but speaks-for tail section validation
  bf844ce5a5f21569c2d5c97d6d1a1c737b5670ab                   is done against given keyid

Fed4FIRE - University of Cantabria - Copyright 2016
```

## Hints
If you need to decode a base64 encoded credential you can use ```base64 --decode s4cred.base64 > s4cred.xml``` (on Linux)

You can check tool certificates information with ```openssl x509 -in <pem_file> -text -noout``` (on Linux)

CA certificates need to be named according to OpenSSL requirements, using the form: hash.0. You can use `rehash.sh` script (see _resources/ca_ folder) inside any folder to generate valid symbolic links to all the existing certificates present in that folder.
