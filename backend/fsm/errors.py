"""Exception base shared by the stored-procedure bridge and FSM runtime."""


class FsmError(RuntimeError):
    """Base class for all expected FSM Platform failures."""
