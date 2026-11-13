#!/usr/bin/env python3
"""Component census of APEXlang (.apx) apps, and how much of it pandawapex can run.

    python3 tools/apex_census.py <dir-with-apx-files> [...] [--json]

Reads application exports in APEXlang format (e.g. Oracle's UPL-licensed sample and starter apps,
https://github.com/oracle/apex), counts every region / item / process / validation / computation /
dynamic action / button by `type:`, and scores coverage weighted by how often each type is used.
It reads metadata only; nothing from the apps is copied into pandawapex.
"""
import json, os, re, sys
from collections import Counter, defaultdict

KINDS = ('region', 'pageItem', 'process', 'validation', 'computation', 'dynamicAction', 'button', 'appItem')
# where the type lives: directly in the block, in a sub-block named after the kind, or (dynamic actions) the event
NESTED = {'validation': 'validation', 'computation': 'computation'}
DEFAULT_TYPE = {'validation': 'expression', 'computation': 'sqlQuery'}  # type when the sub-block names none
START = re.compile(r'^(\s*)(%s) (\S+) \($' % '|'.join(KINDS))

# pandawapex support per APEXlang type: yes / partial / no.  Keep in sync with replica/features.csv.
SUPPORT = {
    'region': {
        'staticContent': 'yes', 'classicReport': 'yes', 'interactiveReport': 'partial', 'form': 'yes',
        'breadcrumb': 'partial', 'interactiveGrid': 'no', 'cards': 'no', 'facetedSearch': 'no', 'chart': 'no',
        'list': 'no', 'tree': 'no', 'map': 'no', 'calendar': 'no', 'plsqlDynamicContent': 'no', 'smartFilters': 'no',
        'searchRegion': 'no', 'contentRow': 'no', 'dynamicContent': 'no', 'templateComponent': 'no',
    },
    'pageItem': {
        'textField': 'yes', 'textarea': 'yes', 'hidden': 'yes', 'displayOnly': 'yes', 'datePicker': 'yes',
        'selectList': 'yes', 'numberField': 'yes', 'password': 'yes', 'popupLov': 'yes', 'switch': 'yes', 'selectOne': 'partial',
        'radioGroup': 'yes', 'checkbox': 'yes', 'checkboxGroup': 'yes', 'fileBrowse': 'no', 'richTextEditor': 'no',
        'shuttle': 'no', 'starRating': 'no', 'colorPicker': 'no', 'combobox': 'no', 'qrCode': 'no', 'imageUpload': 'no',
    },
    'process': {
        'formInitialization': 'yes', 'autoRowFetch': 'yes', 'autoRowProcessing': 'yes', 'formAutoRowProcessing': 'yes', 'executeCode': 'yes', 'closeDialog': 'yes',
        'clearSessionState': 'yes', 'interactiveGridAutoRowProcessing': 'no', 'sendEmail': 'no',
        'invokeApi': 'no', 'executeServerSideCode': 'yes',
    },
    'validation': {
        'itemIsNotNull': 'yes', 'expression': 'yes', 'rowsReturned': 'yes', 'noRowsReturned': 'yes',
        'functionBodyReturningBoolean': 'yes', 'functionBodyReturningErrorText': 'yes', 'functionBody': 'yes', 'itemMatchesRegexp': 'yes',
        'itemIsNumeric': 'yes', 'itemIsAValidTimestamp': 'yes',
    },
    'computation': {
        'staticValue': 'yes', 'item': 'yes', 'sqlQuery': 'yes', 'expression': 'yes', 'functionBody': 'yes',
    },
    'dynamicAction': {}, 'action': {}, 'button': {}, 'appItem': {},
}
DEFAULT = {'dynamicAction': 'no', 'button': 'yes', 'appItem': 'yes'}
UNTYPED = ('button', 'appItem')


def blocks(path):
    lines = open(path, encoding='utf-8', errors='replace').read().splitlines()
    for i, line in enumerate(lines):
        m = START.match(line)
        if not m:
            continue
        indent, kind = len(m.group(1)), m.group(2)
        typ = None
        if kind in UNTYPED:
            yield kind, '(any)'
            continue
        sub = None  # indent of the sub-block that carries the type, when nested
        for j in range(i + 1, min(i + 600, len(lines))):
            l = lines[j]
            ind = len(l) - len(l.lstrip())
            if l.strip() == ')' and ind <= indent:
                break
            if kind in NESTED and ind == indent + 4 and l.strip() == NESTED[kind] + ' {':
                sub = ind
                continue
            if sub is not None and ind == sub and l.strip() == '}':
                typ = DEFAULT_TYPE[kind]  # the sub-block ended without a type: the kind's default
                break
            if kind == 'dynamicAction':
                t = re.match(r'^\s+event: (\S+)', l)
            elif kind in NESTED:
                t = re.match(r'^\s{%d}type: (\S+)' % (sub + 4), l) if sub is not None else None
            else:
                t = re.match(r'^\s{%d}type: (\S+)' % (indent + 4), l)
            if t:
                typ = t.group(1)
                break
        yield kind, typ or '(default)'


def main(argv):
    as_json = '--json' in argv
    roots = [a for a in argv if a != '--json']
    counts = defaultdict(Counter)
    apps = set()
    for root in roots:
        for dp, _, files in os.walk(root):
            for f in files:
                if f.endswith('.apx'):
                    apps.add(dp.split('/apexlang/')[0] if '/apexlang/' in dp else dp)
                    for kind, typ in blocks(os.path.join(dp, f)):
                        counts[kind][typ] += 1
    total = got = 0
    report = {}
    for kind in KINDS:
        rows = []
        for typ, n in counts[kind].most_common():
            st = SUPPORT.get(kind, {}).get(typ, DEFAULT.get(kind, 'no'))
            w = {'yes': 1, 'partial': .5}.get(st, 0)
            total += n
            got += n * w
            rows.append((typ, n, st))
        report[kind] = rows
    score = round(100 * got / total, 1) if total else 0
    if as_json:
        print(json.dumps({'apps': len(apps), 'coverage': score, 'kinds': report}, indent=2))
        return 0
    print(f'{len(apps)} apps, {total} components, usage-weighted coverage {score}%\n')
    for kind, rows in report.items():
        if not rows:
            continue
        n = sum(r[1] for r in rows)
        ok = sum(r[1] * {'yes': 1, 'partial': .5}.get(r[2], 0) for r in rows)
        print(f'{kind:14} {n:6}  covered {100 * ok / n:5.1f}%')
        for typ, c, st in rows[:12]:
            print(f'    {typ:42} {c:6}  {st}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
