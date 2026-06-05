Illustrates how we can cache intermediate results of child functions for reuse by other child functions.

When a child function is done with computing an intermediate result (in this case processing an embedded file that might also be embedded in another function's file), it sends that result to the parent function. Other child functions can then use that result without having to recompute it, simply by asking the parent function whether it has the result cached.
