"""Reader and writer for the Lua-table dialect Fusion uses in .setting files.

A .setting file is one Lua table literal. Values are numbers, strings,
booleans, plain tables `{ ... }`, or constructor tables `Name { ... }` /
`ordered() { ... }`. Keys are identifiers, `["quoted strings"]` or `[numbers]`.

The parser is strict on purpose: the validator relies on it to catch the
mistakes that make Resolve silently refuse a template (unbalanced braces,
a raw newline inside a string, a missing comma between entries).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterator


class LuaSyntaxError(ValueError):
    def __init__(self, message: str, line: int, col: int):
        super().__init__(f"line {line}, col {col}: {message}")
        self.line = line
        self.col = col


@dataclass
class Table:
    """A Lua table, optionally built by a constructor such as `Input { }`.

    `items` keeps source order and duplicates: each entry is (key, value) and
    key is None for positional entries.
    """

    ctor: str | None = None
    items: list[tuple[Any, Any]] = field(default_factory=list)
    line: int = 0

    def get(self, key: Any, default: Any = None) -> Any:
        for k, v in self.items:
            if k == key:
                return v
        return default

    def __contains__(self, key: Any) -> bool:
        return any(k == key for k, _ in self.items)

    def keyed(self) -> Iterator[tuple[Any, Any]]:
        return ((k, v) for k, v in self.items if k is not None)

    def positional(self) -> list[Any]:
        return [v for k, v in self.items if k is None]

    def duplicate_keys(self) -> list[Any]:
        seen: set[Any] = set()
        dupes: list[Any] = []
        for k, _ in self.keyed():
            if k in seen and k not in dupes:
                dupes.append(k)
            seen.add(k)
        return dupes


_TOKEN = re.compile(
    r"""
    (?P<ws>[ \t\r\n]+)
  | (?P<comment>--\[\[.*?\]\]|--[^\n]*)
  | (?P<number>[-+]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?))
  | (?P<name>[A-Za-z_][A-Za-z0-9_.]*)
  | (?P<string>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')
  | (?P<longstring>\[\[.*?\]\])
  | (?P<punct>[{}\[\]=,;()])
    """,
    re.VERBOSE | re.DOTALL,
)

_ESCAPES = {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", '"': '"', "'": "'", "0": "\0"}


def _unescape(body: str) -> str:
    out: list[str] = []
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            out.append(_ESCAPES.get(nxt, nxt))
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _tokenize(text: str) -> list[tuple[str, str, int, int]]:
    tokens: list[tuple[str, str, int, int]] = []
    pos = 0
    line = 1
    line_start = 0
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m:
            col = pos - line_start + 1
            snippet = text[pos : pos + 20].split("\n")[0]
            if text[pos] in "\"'":
                raise LuaSyntaxError(
                    "unterminated string (a raw newline inside quotes makes Resolve reject the file)",
                    line,
                    col,
                )
            raise LuaSyntaxError(f"unexpected text {snippet!r}", line, col)
        kind = m.lastgroup or ""
        value = m.group()
        if kind not in ("ws", "comment"):
            tokens.append((kind, value, line, pos - line_start + 1))
        newlines = value.count("\n")
        if newlines:
            line += newlines
            line_start = pos + value.rfind("\n") + 1
        pos = m.end()
    tokens.append(("eof", "", line, pos - line_start + 1))
    return tokens


class _Parser:
    def __init__(self, text: str):
        self.tokens = _tokenize(text)
        self.i = 0

    def peek(self, offset: int = 0) -> tuple[str, str, int, int]:
        return self.tokens[min(self.i + offset, len(self.tokens) - 1)]

    def next(self) -> tuple[str, str, int, int]:
        tok = self.tokens[self.i]
        self.i += 1
        return tok

    def fail(self, message: str, tok: tuple[str, str, int, int] | None = None) -> LuaSyntaxError:
        tok = tok or self.peek()
        return LuaSyntaxError(message, tok[2], tok[3])

    def expect(self, value: str) -> None:
        tok = self.next()
        if tok[1] != value:
            raise self.fail(f"expected {value!r} but found {tok[1] or 'end of file'!r}", tok)

    def parse_value(self) -> Any:
        kind, value, line, _ = self.peek()
        if kind == "number":
            self.next()
            if value.lower().startswith(("0x", "-0x", "+0x")):
                return int(value, 16)
            num = float(value)
            return int(num) if re.fullmatch(r"[-+]?\d+", value) else num
        if kind == "string":
            self.next()
            return _unescape(value[1:-1])
        if kind == "longstring":
            self.next()
            return value[2:-2]
        if kind == "punct" and value == "{":
            return self.parse_table(None)
        if kind == "name":
            self.next()
            if value == "true":
                return True
            if value == "false":
                return False
            if value == "nil":
                return None
            if self.peek()[1] == "(":
                self.expect("(")
                self.expect(")")
            if self.peek()[1] != "{":
                raise self.fail(f"bare word {value!r} is not a value; expected '{{' after it")
            table = self.parse_table(value)
            table.line = line
            return table
        raise self.fail(f"expected a value but found {value or 'end of file'!r}")

    def parse_table(self, ctor: str | None) -> Table:
        open_tok = self.peek()
        self.expect("{")
        table = Table(ctor=ctor, line=open_tok[2])
        while True:
            kind, value, _, _ = self.peek()
            if value == "}":
                self.next()
                return table
            if kind == "eof":
                raise self.fail(f"table opened on line {open_tok[2]} is never closed", open_tok)
            key: Any = None
            if value == "[":
                self.next()
                key_tok = self.peek()
                key = self.parse_value()
                if not isinstance(key, (str, int, float)):
                    raise self.fail("table key must be a string or a number", key_tok)
                self.expect("]")
                self.expect("=")
            elif kind == "name" and self.peek(1)[1] == "=":
                key = value
                self.next()
                self.next()
            table.items.append((key, self.parse_value()))
            sep = self.peek()[1]
            if sep in (",", ";"):
                self.next()
            elif sep != "}":
                raise self.fail(f"missing comma before {sep or 'end of file'!r}")


def parse(text: str) -> Table:
    """Parse a whole .setting / .comp file into a Table tree."""
    if text.startswith("\ufeff"):
        text = text[1:]
    parser = _Parser(text)
    root = parser.parse_value()
    if parser.peek()[0] != "eof":
        raise parser.fail("unexpected content after the top-level table")
    if not isinstance(root, Table):
        raise LuaSyntaxError("file does not contain a table", 1, 1)
    return root


# ---------------------------------------------------------------- writing

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def format_number(value: float | int) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if value == int(value) and abs(value) < 1e15:
        return str(int(value))
    return repr(round(value, 10))


def quote(text: str) -> str:
    out = text.replace("\\", "\\\\").replace('"', '\\"')
    out = out.replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t")
    return f'"{out}"'


def format_key(key: Any) -> str:
    if isinstance(key, str):
        return key if _IDENT.match(key) else f"[{quote(key)}]"
    return f"[{format_number(key)}]"


def _is_scalar(value: Any) -> bool:
    return not isinstance(value, Table)


def dumps(value: Any, indent: int = 0) -> str:
    """Serialise a Table tree the way Fusion writes it: tabs, trailing commas."""
    if value is None:
        return "nil"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return format_number(value)
    if isinstance(value, str):
        return quote(value)
    if not isinstance(value, Table):
        raise TypeError(f"cannot serialise {type(value).__name__}")

    head = ""
    if value.ctor == "ordered":
        head = "ordered() "
    elif value.ctor:
        head = f"{value.ctor} "
    if not value.items:
        return f"{head}{{ }}"

    # Small all-scalar tables read better on one line: { 0.5, 0.5 }, FuID { "Sine" }
    if all(_is_scalar(v) for _, v in value.items) and len(value.items) <= 4:
        parts = [
            (f"{format_key(k)} = " if k is not None else "") + dumps(v, indent)
            for k, v in value.items
        ]
        one_line = f"{head}{{ {', '.join(parts)}, }}" if any(
            k is not None for k, _ in value.items
        ) else f"{head}{{ {', '.join(parts)} }}"
        if len(one_line) <= 110:
            return one_line

    pad = "\t" * (indent + 1)
    lines = [f"{head}{{"]
    for k, v in value.items:
        prefix = f"{format_key(k)} = " if k is not None else ""
        lines.append(f"{pad}{prefix}{dumps(v, indent + 1)},")
    lines.append("\t" * indent + "}")
    return "\n".join(lines)


def T(ctor: str | None = None, *positional: Any, **keyed: Any) -> Table:
    """Shorthand constructor: T("Input", Value=1) -> Input { Value = 1, }"""
    table = Table(ctor=ctor)
    for v in positional:
        table.items.append((None, v))
    for k, v in keyed.items():
        table.items.append((k, v))
    return table
