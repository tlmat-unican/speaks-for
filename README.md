# Fed4FIRE Speaks-For credential management tools

## Installation
Just install Node.JS and run ```npm install``` on this folder. The tools have been tested on Ubuntu 14.04, but should also work on Windows and MacOS as well.

## Credential generation

```
Usage: speaks-for -c <file-path> -f <p12|pem> -p <password> -t <file-path> -d 10 -o <file-path>

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

Fed4FIRE - University of Cantabria - Copyright 2015
```

## Credential validation

```
Usage: validate-speaks-for -s <file-path>

Speaks-for Parameters
  -s, --s4credential  Speaks-for credential file                                                         [required]
  -f, --format        Provided Speaks-for credential file format              [required] [choices: "base64", "xml"]

Options:
  -v, --verbose  Verbosity level (none, -v or -vv)                                                          [count]
  -h, --help     Show help                                                                                [boolean]
  --version      Show version number                                                                      [boolean]

Examples:
  validate-speaks-for -s s4cred.base64 -f base64  Validates a base64 encoded speaks-for credential
  validate-speaks-for -v -s s4cred.xml -f xml     Validates an xml encoded speaks-for credential with extra
                                                  verbosity level

Fed4FIRE - University of Cantabria - Copyright 2015
```

