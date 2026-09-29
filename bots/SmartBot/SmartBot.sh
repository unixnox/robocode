#!/bin/sh
# Launched by the Robocode Tank Royale booter from this directory.
cd "$(dirname "$0")" || exit 1
java -cp "../lib/*" SmartBot.java
