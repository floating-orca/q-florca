Illustrates how to implement a custom retry mechanism.

Upon timeout, batches are halved in size and we try again.

Note that, technically, invoked functions keep running even after the timeout. The invoking function just doesn't wait for them to finish.  
At the end of the workflow, all functions still running are terminated.
