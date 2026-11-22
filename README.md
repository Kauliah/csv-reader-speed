# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kauliah/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kauliah/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for make.fun's csv-reader 1.0.0: it reads broken CSV files
(the way csv-reader 1.0.0 reads them, error for error) and answers
`{columns, rows, errors}` for every case, in much less CPU time.

## Approach

The reference reader walks the text one character at a time and builds
every field one character at a time. This one never does that on the hot
path: unquoted fields are found with `indexOf` for the next comma and line
break and cut out with `slice`, quoted fields are found with `indexOf` for
the next quote, and the slow character-level work only runs for the rare
broken shapes — a stray CR, a doubled quote, a line break inside quotes,
junk after a closing quote, or an unterminated quote. Everything else is
native string scanning, which is why it is several times faster than the
reference on the same cases.

## Run it

```sh
node main.ts
```

Node 22. It reads the cases from `$MAKEFUN_INPUT_DIR` (or `/input`) and
writes the answers to `$MAKEFUN_OUTPUT_DIR` (or `/output`).

<sub>Entered on [make.fun](https://make.fun/?ref=1807xzra&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
