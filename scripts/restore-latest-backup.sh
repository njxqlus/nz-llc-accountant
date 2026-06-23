#!/bin/sh
set -eu

docker compose run --rm backup restore-latest
