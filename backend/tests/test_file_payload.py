"""Tests for binary-aware file payloads sent to the viewer."""

import base64
from pathlib import Path

import pytest

from backend.files.tree import (
    MAX_BINARY_PREVIEW_BYTES,
    build_file_payload,
    get_file_type,
    read_file_payload,
)
from backend.errors import FileError

PDF_HEADER = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog >>\nendobj\n"
PNG_HEADER = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\x00" * 20


def test_text_file_is_sent_as_utf8(tmp_path: Path) -> None:
    f = tmp_path / "notes.md"
    f.write_text("# hello\n", encoding="utf-8")

    payload = build_file_payload(f, "notes.md")

    assert payload == {
        "path": "notes.md",
        "content": "# hello\n",
        "fileType": "markdown",
        "encoding": "utf-8",
        "size": 8,
    }


def test_latin1_text_still_decodes_as_text(tmp_path: Path) -> None:
    f = tmp_path / "legacy.txt"
    f.write_bytes("caf\xe9\n".encode("latin-1"))

    payload = build_file_payload(f, "legacy.txt")

    assert payload["encoding"] == "utf-8"
    assert payload["content"] == "caf\xe9\n"


def test_pdf_is_base64_with_pdf_type(tmp_path: Path) -> None:
    f = tmp_path / "paper.pdf"
    f.write_bytes(PDF_HEADER)

    payload = build_file_payload(f, "paper.pdf")

    assert payload["fileType"] == "pdf"
    assert payload["encoding"] == "base64"
    assert payload["mime"] == "application/pdf"
    assert payload["size"] == len(PDF_HEADER)
    assert base64.b64decode(payload["content"]) == PDF_HEADER


def test_image_is_base64_with_image_type(tmp_path: Path) -> None:
    f = tmp_path / "shot.png"
    f.write_bytes(PNG_HEADER)

    payload = build_file_payload(f, "shot.png")

    assert payload["fileType"] == "image"
    assert payload["mime"] == "image/png"
    assert base64.b64decode(payload["content"]) == PNG_HEADER


def test_unknown_extension_with_null_bytes_is_binary(tmp_path: Path) -> None:
    f = tmp_path / "blob.dat"
    f.write_bytes(b"abc\x00def" * 100)

    payload = build_file_payload(f, "blob.dat")

    assert payload["fileType"] == "binary"
    assert payload["encoding"] == "base64"
    assert payload["mime"] == "application/octet-stream"


def test_unknown_extension_without_null_bytes_is_text(tmp_path: Path) -> None:
    f = tmp_path / "Makefile"
    f.write_text("all:\n\techo hi\n")

    payload = build_file_payload(f, "Makefile")

    assert payload["encoding"] == "utf-8"
    assert payload["fileType"] == "plaintext"


def test_oversized_binary_sends_no_content(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("backend.files.tree.MAX_BINARY_PREVIEW_BYTES", 16)
    f = tmp_path / "big.pdf"
    f.write_bytes(PDF_HEADER)

    payload = build_file_payload(f, "big.pdf")

    assert payload["fileType"] == "pdf"
    assert payload["encoding"] == "none"
    assert payload["content"] == ""
    assert payload["size"] == len(PDF_HEADER)


def test_default_cap_is_generous_but_bounded() -> None:
    assert 1_000_000 < MAX_BINARY_PREVIEW_BYTES <= 100 * 1024 * 1024


def test_read_file_payload_confines_to_root(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    (tmp_path / "secret.pdf").write_bytes(PDF_HEADER)

    with pytest.raises(FileError):
        read_file_payload(root, "../secret.pdf")


def test_read_file_payload_reports_relative_path(tmp_path: Path) -> None:
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "a.pdf").write_bytes(PDF_HEADER)

    payload = read_file_payload(tmp_path, "docs/a.pdf")

    assert payload["path"] == "docs/a.pdf"
    assert payload["fileType"] == "pdf"


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("x.pdf", "pdf"),
        ("x.PNG", "image"),
        ("x.jpeg", "image"),
        ("x.webp", "image"),
        ("x.zip", "binary"),
        ("x.woff2", "binary"),
        ("x.py", "python"),
    ],
)
def test_get_file_type_knows_binary_kinds(name: str, expected: str) -> None:
    assert get_file_type(name) == expected
