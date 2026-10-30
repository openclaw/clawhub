"""Nonpublishing diagnostic: project trusted exception locations, never messages."""

import atexit
import hashlib
import json
import os
import re
import stat
import sys
import threading

BASE_SHA256 = "094b5eaa3d3b0cfa5bbd77891e4111f4af594716ffd6a93b7ac6afb7cd32b165"
MODULES = {
    "skillspector.llm_analyzer_base": "skillspector_llm",
    "skillspector.llm_utils": "skillspector_llm_utils",
    "skillspector.inference_usage": "skillspector_usage",
    "skillspector.providers.chat_models": "skillspector_chat_models",
    "skillspector.providers.structured_output": "skillspector_structured_output",
    "langchain_openai.chat_models.base": "langchain_openai_base",
    "langchain_core.language_models.chat_models": "langchain_chat_models",
    "langchain_core.runnables.base": "langchain_runnables",
    "langchain_core.output_parsers.openai_tools": "langchain_openai_tools",
    "langchain_core.output_parsers.json": "langchain_json_parser",
    "langchain_core.output_parsers.pydantic": "langchain_pydantic_parser",
    "openai._base_client": "openai_client",
    "openai._response": "openai_response",
    "openai.resources.responses.responses": "openai_responses",
    "openai._utils._utils": "openai_utils",
    "pydantic.main": "pydantic_main",
    "pydantic.type_adapter": "pydantic_adapter",
    "httpx._client": "httpx_client",
    "httpx._models": "httpx_models",
    "json.encoder": "json_encoder",
    "typing": "typing",
}
CLASSES = {
    "TypeError", "ValueError", "RuntimeError", "ValidationError", "RateLimitError",
    "APIConnectionError", "APITimeoutError", "BadRequestError", "InternalServerError",
    "AuthenticationError", "PermissionDeniedError", "APIResponseValidationError",
}
ERROR_TOKENS = {
    "mock_val_ser": "MockValSer", "schema_serializer": "SchemaSerializer",
    "not_instance": "not an instance", "cannot_convert": "cannot be converted",
    "none_type": "NoneType", "unexpected_keyword": "unexpected keyword",
    "required_argument": "required positional argument", "not_callable": "not callable",
    "not_iterable": "not iterable", "unhashable": "unhashable",
    "unknown_type": "unknown type", "not_json": "not JSON serializable",
    "serialization_info": "SerializationInfo", "polymorphic": "polymorphic_serialization",
    "serialize_as_any": "serialize_as_any", "include": "include", "exclude": "exclude",
    "dict_type": "'dict'", "list_type": "'list'", "str_type": "'str'",
    "int_type": "'int'", "tuple_type": "'tuple'", "bytes_type": "'bytes'",
}


def serializer_failure(exc, frame):
    if type(exc).__name__ != "TypeError":
        return None
    builtin = type(exc) is TypeError
    args = exc.args if builtin else ()
    kinds = ((str, "str"), (int, "int"), (float, "float"), (bool, "bool"),
             (type(None), "none"), (bytes, "bytes"))
    value = {
        "builtinTypeError": builtin,
        "argumentKinds": [next((label for cls, label in kinds if type(arg) is cls), "other")
                          for arg in args[:3]],
        "argumentsTruncated": len(args) > 3,
        "qualifiedDump": frame is not None,
        "tokensInspected": False,
        "tokens": [], "model": "unavailable", "modelComplete": None,
        "serializer": "unavailable",
    }
    if frame is None:
        return value
    if len(args) == 1 and type(args[0]) is str and len(args[0]) <= 2048:
        value["tokensInspected"] = True
        value["tokens"] = [label for label, token in ERROR_TOKENS.items() if token in args[0]]
    # Only inspect class dictionaries; never call model properties or serializers.
    cls = type(frame.f_locals.get("self"))
    mro = cls.__mro__[:16]
    response_module = sys.modules.get("openai.types.responses.response")
    parsed_module = sys.modules.get("openai.types.responses.parsed_response")
    response = vars(response_module).get("Response") if response_module else None
    parsed = vars(parsed_module).get("ParsedResponse") if parsed_module else None
    family = "parsed_response" if parsed in mro else "response" if response in mro else "other"
    value["model"] = family
    value["serializer"] = "other"
    if family == "other":
        return value
    def class_value(key):
        missing = object()
        for base in mro:
            result = base.__dict__.get(key, missing)
            if result is not missing:
                return result
        return None

    complete = class_value("__pydantic_complete__")
    value["modelComplete"] = complete if type(complete) is bool else None
    serializer = class_value("__pydantic_serializer__")
    serializer_type = type(serializer)
    value["serializer"] = {
        ("pydantic_core._pydantic_core", "SchemaSerializer"): "schema",
        ("pydantic._internal._mock_val_ser", "MockValSer"): "mock",
        ("builtins", "NoneType"): "missing",
    }.get((serializer_type.__module__, serializer_type.__name__), "other")
    return value


def project_exception(exc):
    chain = []
    seen = set()
    while isinstance(exc, BaseException) and id(exc) not in seen and len(chain) < 3:
        seen.add(id(exc))
        frames = []
        unknown = 0
        trace = exc.__traceback__
        traversed = 0
        dump_frame = None
        while trace is not None and traversed < 64:
            traversed += 1
            frame = trace.tb_frame
            name = frame.f_globals.get("__name__")
            module = sys.modules.get(name) if isinstance(name, str) else None
            source = getattr(module, "__file__", None)
            if (name in MODULES and isinstance(source, str)
                    and frame.f_globals is module.__dict__
                    and os.path.realpath(frame.f_code.co_filename) == os.path.realpath(source)
                    and 0 < trace.tb_lineno <= 1_000_000):
                frames.append({"module": MODULES[name], "line": trace.tb_lineno})
                if name == "pydantic.main" and frame.f_code.co_name == "model_dump" and dump_frame is None:
                    dump_frame = frame
            else:
                unknown += 1
            trace = trace.tb_next
        code = getattr(exc, "status_code", None)
        chain.append({
            "class": type(exc).__name__ if type(exc).__name__ in CLASSES else "other",
            "mockSchemaSerializer": (
                type(exc) is TypeError and len(exc.args) == 1
                and type(exc.args[0]) is str
                and exc.args[0] == "'MockValSer' object cannot be converted to 'SchemaSerializer'"
            ),
            "serializerFailure": serializer_failure(exc, dump_frame),
            "statusCode": code if type(code) is int and 100 <= code <= 599 else None,
            "frames": frames[-8:],
            "unknownFrames": unknown,
            "framesTruncated": len(frames) > 8 or trace is not None,
        })
        exc = exc.__cause__ or exc.__context__
    return chain


def observe_classifier(original, record):
    def classified(exc):
        # Observation must not alter classification, retrying, or exception behavior.
        result = original(exc)
        try:
            record(exc)
        except Exception:
            pass
        return result
    return classified


def main(output):
    from skillspector import llm_analyzer_base as base
    with open(base.__file__, "rb") as source:
        if hashlib.sha256(source.read()).hexdigest() != BASE_SHA256:
            raise RuntimeError("Unqualified analyzer source")
    args = sys.argv[1:]
    index = args.index("--output")
    match = re.fullmatch(r"skillspector-report-(\d+)\.json", os.path.basename(args[index + 1]))
    if match is None or not 0 <= int(match.group(1)) < 62:
        raise RuntimeError("Fixed diagnostic output required")
    root_index = int(match.group(1))
    lock = threading.Lock()
    counts = {"calls": 0, "written": 0, "writeFailures": 0}

    def append(value):
        data = (json.dumps({"rootIndex": root_index, **value}, separators=(",", ":")) + "\n").encode()
        fd = os.open(output, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size + len(data) > 2 * 1024 * 1024:
                raise RuntimeError("Invalid observer output")
            if os.write(fd, data) != len(data):
                raise RuntimeError("Incomplete observer write")
        finally:
            os.close(fd)

    def record(exc):
        with lock:
            counts["calls"] += 1
            if counts["written"] >= 8:
                return
            try:
                append({"kind": "failure", "chain": project_exception(exc)})
                counts["written"] += 1
            except Exception:
                counts["writeFailures"] += 1

    append({"kind": "installed"})
    base._provider_failure_class = observe_classifier(base._provider_failure_class, record)

    def finished():
        try:
            append({"kind": "finished", **counts})
        except Exception:
            pass

    atexit.register(finished)
    from skillspector.cli import app
    app()


if __name__ == "__main__":
    main(DIAGNOSTIC_OUTPUT)
