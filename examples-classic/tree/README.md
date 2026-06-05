Illustrates how child functions could let their parent know to invoke more child functions, for example when yet unprocessed data is found.

The example shows how this technique could be used to process a tree whose exact structure is not known in advance.
It could be used to crawl hierarchical docs pages or file systems, for example.

To start the workflow, run it with one of the following CLI arguments:

- `--entry-point process`
- `--entry-point processWithDelay`
  - Pass `-i '{ "onAws": true }'` to let it invoke `processNodeOnAws` instead of `processNode`
    - For this to work, your engine must be accessible from the AWS Lambda function,
      meaning it must be publicly available or in the same VPC as the Lambda function
