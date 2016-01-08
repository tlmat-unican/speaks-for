#!/bin/bash
rm -v *.0 2> /dev/null;
for file in `ls | egrep '\.pem$|\.crt$|\.cert$|\.gid$'`;
do
  ln -vs $file `openssl x509 -hash -noout -in $file`.0;
done