const C = require("tree-sitter-c/grammar")

const PREC = Object.assign(C.PREC, {
  LAMBDA: 18,
  NEW: C.PREC.CALL + 1,
  STRUCTURED_BINDING: -1,
  THREE_WAY: C.PREC.RELATIONAL + 1,
})

const FOLD_OPERATORS = [
  '+', '-', '*', '/', '%',
  '^', '&', '|',
  '=', '<', '>',
  '<<', '>>',
  '+=', '-=', '*=', '/=', '%=', '^=', '&=', '|=',
  '>>=', '<<=',
  '==', '!=', '<=', '>=',
  '&&', '||',
  ',',
  '.*', '->*',
  'or', 'and', 'bitor', 'xor', 'bitand', 'not_eq',
]

module.exports = grammar(C, {
  name: 'cpp',

  externals: $ => [
    $.raw_string_delimiter,
    $.raw_string_content,
  ],

  conflicts: ($, original) => original.concat([
    [$.template_function, $.template_type],
    [$.template_function, $.template_type, $._expression],
    [$.template_function, $.template_type, $.qualified_identifier],
    [$.template_method, $.field_expression],
    [$.template_type, $.qualified_type_identifier],
    [$.qualified_type_identifier, $.qualified_identifier],
    [$.dependent_type_identifier, $.dependent_identifier],
    [$.comma_expression, $.initializer_list],
    [$._expression, $._declarator],
    [$._expression, $.structured_binding_declarator],
    [$._expression, $._declarator, $._type_specifier],
    [$.parameter_list, $.argument_list],
    [$._type_specifier, $.call_expression],
    [$._declaration_specifiers, $._constructor_specifiers],
    [$._declaration_modifiers, $.operator_cast_declaration, $.operator_cast_definition, $.constructor_or_destructor_definition],
    [$._declaration_modifiers, $.attributed_statement, $.operator_cast_declaration, $.operator_cast_definition, $.constructor_or_destructor_definition],
    [$.attributed_statement, $.operator_cast_declaration, $.operator_cast_definition, $.constructor_or_destructor_definition],
    [$._binary_fold_operator, $._fold_operator],
    [$.expression_statement, $.for_statement],
    [$.init_statement, $.for_statement],

    // all of these can be parsed as (X_specifier (export_specifier) ...)
    // or (export_specifier) (X_specifier ...)
    [$.enum_specifier],
    [$.class_specifier],
    [$.struct_specifier],
    [$.union_specifier],

    [$.storage_class_specifier, $.template_instantiation],
  ]),

  inline: ($, original) => original.concat([
    $._namespace_identifier,
  ]),

  rules: {
    _top_level_item: ($, original) => choice(
      original,
      $.namespace_definition,
      $.concept_definition,
      $.namespace_alias_definition,
      $.using_declaration,
      $.alias_declaration,
      $.static_assert_declaration,
      $.template_declaration,
      $.template_instantiation,
      alias($.constructor_or_destructor_definition, $.function_definition),
      alias($.operator_cast_definition, $.function_definition),
      alias($.operator_cast_declaration, $.declaration),
      $.module_declaration,
      $.module_fragment_declaration,
      $.import_declaration,
      $.export_block,
    ),

    // Types

    placeholder_type_specifier: $ => prec(1, seq(
      field('constraint', optional($._type_specifier)),
      choice($.auto, alias($.decltype_auto, $.decltype))
    )),

    auto: $ => 'auto',
    decltype_auto: $ => seq(
      'decltype',
      '(',
      $.auto,
      ')'
    ),
    decltype: $ => seq(
      'decltype',
      '(',
      $._expression,
      ')',
    ),

    _type_specifier: $ => choice(
      $.struct_specifier,
      $.union_specifier,
      $.enum_specifier,
      $.class_specifier,
      $.sized_type_specifier,
      $.primitive_type,
      $.template_type,
      $.dependent_type,
      $.placeholder_type_specifier,
      $.decltype,
      prec.right(choice(
        alias($.qualified_type_identifier, $.qualified_identifier),
        $._type_identifier
      ))
    ),

    type_qualifier: ($, original) => choice(
      original,
      'mutable',
      'constexpr',
      'constinit',
      'consteval',
    ),

    type_descriptor: ($, original) => prec.right(original),

    // When used in a trailing return type, these specifiers can now occur immediately before
    // a compound statement. This introduces a shift/reduce conflict that needs to be resolved
    // with an associativity.
    _class_declaration: $ => prec.right(seq(
      optional($.ms_declspec_modifier),
      repeat($.attribute_declaration),
      choice(
        field('name', $._class_name),
        seq(
          optional(field('name', $._class_name)),
          optional($.virtual_specifier),
          optional($.base_class_clause),
          field('body', $.field_declaration_list)
        )
      )
    )),

    class_specifier: $ => seq(
      optional($.export_specifier),
      'class',
      $._class_declaration
    ),

    union_specifier: $ => seq(
      optional($.export_specifier),
      'union',
      $._class_declaration
    ),

    struct_specifier: $ => seq(
      optional($.export_specifier),
      'struct',
      $._class_declaration
    ),

    _class_name: $ => prec.right(choice(
      $._type_identifier,
      $.template_type,
      alias($.qualified_type_identifier, $.qualified_identifier)
    )),

    function_definition: ($, original) => seq(
      optional($.export_specifier),
      {
        ...original,
        members: original.members.map(
          e => e.name !== 'body'
            ? e
            : field('body', choice(e.content, $.try_statement)))
      }
    ),

    virtual_specifier: $ => choice(
      'final', // the only legal value here for classes
      'override' // legal for functions in addition to final, plus permutations.
    ),

    virtual: $ => choice('virtual'),

    _declaration_modifiers: ($, original) => choice(
      original,
      $.virtual,
    ),

    explicit_function_specifier: $ => choice(
      'explicit',
      prec(PREC.CALL, seq(
        'explicit',
        '(',
        $._expression,
        ')'
      ))
    ),

    base_class_clause: $ => seq(
      ':',
      commaSep1(seq(
        repeat($.attribute_declaration),
        optional(choice(
          $.access_specifier,
          seq($.access_specifier, $.virtual),
          seq($.virtual, $.access_specifier)
        )),
        $._class_name,
        optional('...')
      ))
    ),

    enum_specifier: $ => prec.right(seq(
      optional($.export_specifier),
      'enum',
      optional(choice('class', 'struct')),
      choice(
        seq(
          field('name', $._class_name),
          optional($._enum_base_clause),
          optional(field('body', $.enumerator_list))
        ),
        field('body', $.enumerator_list)
      )
    )),

    _enum_base_clause: $ => prec.left(seq(
      ':',
      field('base', choice(
        alias($.qualified_type_identifier, $.qualified_identifier),
        $._type_identifier,
        $.sized_type_specifier
      ))
    )),

    // The `auto` storage class is removed in C++0x in order to allow for the `auto` type.
    storage_class_specifier: ($, original) => choice(
      ...original.members.filter(member => member.value !== 'auto'),
      'thread_local',
    ),

    dependent_type: $ => prec.dynamic(-1, prec.right(seq(
      'typename',
      $._type_specifier
    ))),

    // Declarations

    module_access_specifier: $ => seq(':', 'private'),
    module_fragment_declaration: $ => seq(
      'module',
      optional(alias($.module_access_specifier, $.access_specifier)),
      ';'
    ),

    // NB: this is a C++20 specifier from the Modules TS, not the pre-C++11 one
    export_specifier: $ => 'export',

    _module_name: $ => alias($.identifier, $.module_name),
    _module_name_qualifier: $ => repeat1(seq($._module_name, '.')),
    module_qualified_name: $ => seq(
      optional($._module_name_qualifier),
      $._module_name
    ),

    module_partition: $ => seq(':', $._module_name),

    module_declaration: $ => seq(
      optional($.export_specifier),
      'module',
      $.module_qualified_name,
      optional($.module_partition),
      optional($.attribute_declaration),
      ';'
    ),

    import_declaration: $ => seq(
      optional($.export_specifier),
      'import',
      field('name', choice(
        $.module_qualified_name,
        $.module_partition,
        $.string_literal,
        $.system_lib_string,
        // can't distinguish between a module name and a preprocessor macro
        // assume module name as it's more common
        // $.identifier,
        alias($.preproc_call_expression, $.call_expression)
      )),
      optional($.attribute_declaration),
      ';'
    ),

    export_block: $ => seq(
      'export',
      field('body', $.declaration_list)
    ),

    // repeat exportable C definitions
    linkage_specification: ($, original) => seq(
      optional($.export_specifier),
      original,
    ),

    declaration: ($, original) => seq(
      optional($.export_specifier),
      original,
    ),

    type_definition: ($, original) => seq(
      optional($.export_specifier),
      original,
    ),

    template_declaration: $ => seq(
      optional($.export_specifier),
      'template',
      field('parameters', $.template_parameter_list),
      optional($.requires_clause),
      choice(
        $._empty_declaration,
        $.alias_declaration,
        $.declaration,
        $.template_declaration,
        $.function_definition,
        $.concept_definition,
        $.friend_declaration,
        alias($.constructor_or_destructor_declaration, $.declaration),
        alias($.constructor_or_destructor_definition, $.function_definition),
        alias($.operator_cast_declaration, $.declaration),
        alias($.operator_cast_definition, $.function_definition),
      )
    ),

    template_instantiation: $ => seq(
      optional($.export_specifier),
      optional(alias('extern', $.storage_class_specifier)),
      'template',
      optional($._declaration_specifiers),
      field('declarator', choice(
        $._declarator,
        seq(
          choice(
            'enum',
            'enum class',
            'enum struct',
            'struct',
            'class',
            'union'
          ),
          $.template_type
        )
      )),
      ';'
    ),

    template_parameter_list: $ => seq(
      '<',
      commaSep(choice(
        $.parameter_declaration,
        $.optional_parameter_declaration,
        $.type_parameter_declaration,
        $.variadic_parameter_declaration,
        $.variadic_type_parameter_declaration,
        $.optional_type_parameter_declaration,
        $.template_template_parameter_declaration
      )),
      alias(token(prec(1, '>')), '>')
    ),

    type_parameter_declaration: $ => prec(1, seq(
      choice('typename', 'class'),
      optional($._type_identifier)
    )),

    variadic_type_parameter_declaration: $ => prec(1, seq(
      choice('typename', 'class'),
      '...',
      optional($._type_identifier)
    )),

    optional_type_parameter_declaration: $ => seq(
      choice('typename', 'class'),
      optional(field('name', $._type_identifier)),
      '=',
      field('default_type', $._type_specifier)
    ),

    template_template_parameter_declaration: $ => seq(
      'template',
      field('parameters', $.template_parameter_list),
      choice(
        $.type_parameter_declaration,
        $.variadic_type_parameter_declaration,
        $.optional_type_parameter_declaration
      )
    ),

    parameter_list: $ => seq(
      '(',
      commaSep(choice(
        $.parameter_declaration,
        $.optional_parameter_declaration,
        $.variadic_parameter_declaration,
        '...'
      )),
      ')'
    ),

    optional_parameter_declaration: $ => seq(
      $._declaration_specifiers,
      field('declarator', optional($._declarator)),
      '=',
      field('default_value', $._expression)
    ),

    variadic_parameter_declaration: $ => seq(
      $._declaration_specifiers,
      field('declarator', choice(
        $.variadic_declarator,
        alias($.variadic_reference_declarator, $.reference_declarator)
      ))
    ),

    variadic_declarator: $ => seq(
      '...',
      optional($.identifier)
    ),

    variadic_reference_declarator: $ => seq(
      choice('&&', '&'),
      $.variadic_declarator
    ),

    init_declarator: ($, original) => choice(
      original,
      seq(
        field('declarator', $._declarator),
        field('value', choice(
          $.argument_list,
          $.initializer_list
        ))
      )
    ),

    operator_cast: $ => prec.right(1, seq(
      'operator',
      $._declaration_specifiers,
      field('declarator', $._abstract_declarator),
    )),

    // Avoid ambiguity between compound statement and initializer list in a construct like:
    //   A b {};
    compound_statement: ($, original) => prec(-1, original),

    field_initializer_list: $ => seq(
      ':',
      commaSep1($.field_initializer)
    ),

    field_initializer: $ => prec(1, seq(
      choice(
        $._field_identifier,
        $.template_method,
        alias($.qualified_field_identifier, $.qualified_identifier),
      ),
      choice($.initializer_list, $.argument_list),
      optional('...')
    )),

    _field_declaration_list_item: ($, original) => choice(
      original,
      $.template_declaration,
      alias($.inline_method_definition, $.function_definition),
      alias($.constructor_or_destructor_definition, $.function_definition),
      alias($.constructor_or_destructor_declaration, $.declaration),
      alias($.operator_cast_definition, $.function_definition),
      alias($.operator_cast_declaration, $.declaration),
      $.friend_declaration,
      seq($.access_specifier, ':'),
      $.alias_declaration,
      $.using_declaration,
      $.type_definition,
      $.static_assert_declaration
    ),

    field_declaration: $ => seq(
      $._declaration_specifiers,
      commaSep(field('declarator', $._field_declarator)),
      optional(choice(
        $.bitfield_clause,
        field('default_value', $.initializer_list),
        seq('=', field('default_value', choice($._expression, $.initializer_list)))
      )),
      ';'
    ),

    inline_method_definition: $ => seq(
      $._declaration_specifiers,
      field('declarator', $._field_declarator),
      choice(
        field('body', choice($.compound_statement, $.try_statement)),
        $.default_method_clause,
        $.delete_method_clause
      )
    ),

    _constructor_specifiers: $ => choice(
      $._declaration_modifiers,
      $.explicit_function_specifier
    ),

    operator_cast_definition: $ => seq(
      repeat($._constructor_specifiers),
      field('declarator', choice(
        $.operator_cast,
        alias($.qualified_operator_cast_identifier, $.qualified_identifier)
      )),
      field('body', choice($.compound_statement, $.try_statement))
    ),

    operator_cast_declaration: $ => prec(1, seq(
      repeat($._constructor_specifiers),
      field('declarator', choice(
        $.operator_cast,
        alias($.qualified_operator_cast_identifier, $.qualified_identifier)
      )),
      optional(seq('=', field('default_value', $._expression))),
      ';'
    )),

    constructor_try_statement: $ => seq(
      'try',
      optional($.field_initializer_list),
      field('body', $.compound_statement),
      repeat1($.catch_clause)
    ),

    constructor_or_destructor_definition: $ => seq(
      repeat($._constructor_specifiers),
      field('declarator', $.function_declarator),
      choice(
        seq(
          optional($.field_initializer_list),
          field('body', $.compound_statement)
        ),
        alias($.constructor_try_statement, $.try_statement),
        $.default_method_clause,
        $.delete_method_clause
      )
    ),

    constructor_or_destructor_declaration: $ => seq(
      repeat($._constructor_specifiers),
      field('declarator', $.function_declarator),
      ';'
    ),

    default_method_clause: $ => seq('=', 'default', ';'),
    delete_method_clause: $ => seq('=', 'delete', ';'),

    friend_declaration: $ => seq(
      'friend',
      choice(
        $.declaration,
        $.function_definition,
        seq(
          optional(choice(
            'class',
            'struct',
            'union'
          )),
          $._class_name, ';'
        )
      )
    ),

    access_specifier: $ => choice(
      'public',
      'private',
      'protected'
    ),

    _declarator: ($, original) => choice(
      original,
      $.reference_declarator,
      $.qualified_identifier,
      $.template_function,
      $.operator_name,
      $.destructor_name,
      $.structured_binding_declarator
    ),

    _field_declarator: ($, original) => choice(
      original,
      alias($.reference_field_declarator, $.reference_declarator),
      $.template_method,
      $.operator_name
    ),

    _abstract_declarator: ($, original) => choice(
      original,
      $.abstract_reference_declarator
    ),

    reference_declarator: $ => prec.dynamic(1, prec.right(seq(choice('&', '&&'), $._declarator))),
    reference_field_declarator: $ => prec.dynamic(1, prec.right(seq(choice('&', '&&'), $._field_declarator))),
    abstract_reference_declarator: $ => prec.right(seq(choice('&', '&&'), optional($._abstract_declarator))),

    structured_binding_declarator: $ => prec.dynamic(PREC.STRUCTURED_BINDING, seq(
      '[', commaSep1($.identifier), ']'
    )),

    ref_qualifier: $ => choice('&', '&&'),

    _function_declarator_seq: $ => prec.right(seq(
      field('parameters', $.parameter_list),
      repeat($.attribute_specifier),
      repeat($.type_qualifier),
      optional($.ref_qualifier),
      optional(choice(
        $.noexcept,
        $.throw_specifier,
      )),
      repeat($.attribute_declaration),
      optional($.trailing_return_type),
      optional(choice(
        repeat($.virtual_specifier),
        $.requires_clause
      ))
    )),

    function_declarator: $ => prec.dynamic(1, seq(
      field('declarator', $._declarator),
      $._function_declarator_seq,
    )),

    function_field_declarator: $ => prec.dynamic(1, seq(
      field('declarator', $._field_declarator),
      $._function_declarator_seq,
    )),

    abstract_function_declarator: $ => seq(
      field('declarator', optional($._abstract_declarator)),
      $._function_declarator_seq,
    ),

    trailing_return_type: $ => seq('->', $.type_descriptor),

    noexcept: $ => prec.right(seq(
      'noexcept',
      optional(
        seq(
          '(',
          optional($._expression),
          ')',
        ),
      ),
    )),

    throw_specifier: $ => seq(
      'throw',
      seq(
        '(',
        commaSep($.type_descriptor),
        ')',
      )
    ),

    template_type: $ => seq(
      field('name', $._type_identifier),
      field('arguments', $.template_argument_list)
    ),

    template_method: $ => seq(
      field('name', $._field_identifier),
      field('arguments', $.template_argument_list)
    ),

    template_function: $ => seq(
      field('name', $.identifier),
      field('arguments', $.template_argument_list)
    ),

    template_argument_list: $ => seq(
      '<',
      commaSep(choice(
        prec.dynamic(3, $.type_descriptor),
        prec.dynamic(2, alias($.type_parameter_pack_expansion, $.parameter_pack_expansion)),
        prec.dynamic(1, $._expression)
      )),
      alias(token(prec(1, '>')), '>')
    ),

    namespace_definition: $ => seq(
      optional($.export_specifier),
      optional('inline'),
      'namespace',
      field('name', optional(
        choice(
          $._namespace_identifier,
          $.nested_namespace_specifier,
        ))),
      field('body', $.declaration_list)
    ),

    namespace_alias_definition: $ => seq(
      optional($.export_specifier),
      'namespace',
      field('name', $._namespace_identifier),
      '=',
      choice(
        $._namespace_identifier,
        $.nested_namespace_specifier
      ),
      ';'
    ),

    _namespace_specifier: $ => seq(
      optional('inline'),
      $._namespace_identifier
    ),

    nested_namespace_specifier: $ => prec(1, seq(
      optional($._namespace_specifier),
      '::',
      choice(
        $.nested_namespace_specifier,
        $._namespace_specifier
      )
    )),

    using_declaration: $ => seq(
      optional($.export_specifier),
      'using',
      optional(choice('namespace', 'enum')),
      choice(
        $.identifier,
        $.qualified_identifier
      ),
      ';'
    ),

    alias_declaration: $ => seq(
      optional($.export_specifier),
      'using',
      field('name', $._type_identifier),
      repeat($.attribute_declaration),
      '=',
      field('type', $.type_descriptor),
      ';'
    ),

    static_assert_declaration: $ => seq(
      'static_assert',
      '(',
      field('condition', $._expression),
      optional(seq(
        ',',
        field('message', choice(
          $.string_literal,
          $.raw_string_literal,
          $.concatenated_string,
        ))
      )),
      ')',
      ';'
    ),

    concept_definition: $ => seq(
      'concept',
      field('name', $.identifier),
      '=',
      $._expression,
      ';'
    ),

    // Statements

    _non_case_statement: ($, original) => choice(
      original,
      $.co_return_statement,
      $.co_yield_statement,
      $.for_range_loop,
      $.try_statement,
      $.throw_statement,
    ),

    switch_statement: $ => seq(
      'switch',
      field('condition', $.condition_clause),
      field('body', $.compound_statement)
    ),

    while_statement: $ => seq(
      'while',
      field('condition', $.condition_clause),
      field('body', $._statement)
    ),

    if_statement: $ => prec.right(seq(
      'if',
      optional('constexpr'),
      field('condition', $.condition_clause),
      field('consequence', $._statement),
      optional(seq(
        'else',
        field('alternative', $._statement)
      ))
    )),

    for_range_loop: $ => seq(
      'for',
      '(',
      field('initializer', optional($.init_statement)),
      $._declaration_specifiers,
      field('declarator', $._declarator),
      ':',
      field('right', choice(
        $._expression,
        $.initializer_list,
      )),
      ')',
      field('body', $._statement)
    ),

    init_statement: $ => choice(
      $.alias_declaration,
      $.type_definition,
      $.declaration,
      $.expression_statement,
    ),

    condition_clause: $ => seq(
      '(',
      field('initializer', optional($.init_statement)),
      field('value', choice(
        $._expression,
        $.comma_expression,
        alias($.condition_declaration, $.declaration),
      )),
      ')',
    ),

    condition_declaration: $ => seq(
      $._declaration_specifiers,
      field('declarator', $._declarator),
      choice(
        seq(
          '=',
          field('value', $._expression),
        ),
        field('value', $.initializer_list),
      )
    ),

    return_statement: ($, original) => seq(
      choice(
        original,
        seq('return', $.initializer_list, ';')
      )
    ),

    co_return_statement: $ => seq(
      'co_return',
      optional($._expression),
      ';'
    ),

    co_yield_statement: $ => seq(
      'co_yield',
      $._expression,
      ';'
    ),

    throw_statement: $ => seq(
      'throw',
      optional($._expression),
      ';'
    ),

    try_statement: $ => seq(
      'try',
      field('body', $.compound_statement),
      repeat1($.catch_clause)
    ),

    catch_clause: $ => seq(
      'catch',
      field('parameters', $.parameter_list),
      field('body', $.compound_statement)
    ),

    // Expressions

    _expression: ($, original) => choice(
      original,
      $.co_await_expression,
      $.requires_expression,
      $.requires_clause,
      $.template_function,
      $.qualified_identifier,
      $.new_expression,
      $.delete_expression,
      $.lambda_expression,
      $.parameter_pack_expansion,
      $.nullptr,
      $.this,
      $.raw_string_literal,
      $.user_defined_literal,
      $.fold_expression
    ),

    raw_string_literal: $ => seq(
      choice('R"', 'LR"', 'uR"', 'UR"', 'u8R"'),
      choice(
        seq(
          field('delimiter', $.raw_string_delimiter),
          '(',
          $.raw_string_content,
          ')',
          $.raw_string_delimiter,
        ),
        seq(
          '(',
          $.raw_string_content,
          ')',
        )),
      '"',
    ),

    subscript_expression: $ => prec(PREC.SUBSCRIPT, seq(
      field('argument', $._expression),
      '[',
      field('index', choice($._expression, $.initializer_list)),
      ']'
    )),


    call_expression: ($, original) => choice(original, seq(
      field('function', $.primitive_type),
      field('arguments', $.argument_list)
    )),

    co_await_expression: $ => prec.left(PREC.UNARY, seq(
      field('operator', 'co_await'),
      field('argument', $._expression)
    )),

    new_expression: $ => prec.right(PREC.NEW, seq(
      optional('::'),
      'new',
      field('placement', optional($.argument_list)),
      field('type', $._type_specifier),
      field('declarator', optional($.new_declarator)),
      field('arguments', optional(choice(
        $.argument_list,
        $.initializer_list
      )))
    )),

    new_declarator: $ => prec.right(seq(
      '[',
      field('length', $._expression),
      ']',
      optional($.new_declarator)
    )),

    delete_expression: $ => seq(
      optional('::'),
      'delete',
      optional(seq('[', ']')),
      $._expression
    ),

    field_expression: ($, original) => choice(
      original,
      seq(
        prec(PREC.FIELD, seq(
          field('argument', $._expression),
          choice('.', '->')
        )),
        field('field', choice(
          $.destructor_name,
          $.template_method,
          alias($.dependent_field_identifier, $.dependent_name)
        ))
      )
    ),

    type_requirement: $ => seq('typename', $._class_name),

    compound_requirement: $ => seq(
      '{', $._expression, '}',
      optional('noexcept'),
      optional($.trailing_return_type),
      ';'
    ),

    _requirement: $ => choice(
      alias($.expression_statement, $.simple_requirement),
      $.type_requirement,
      $.compound_requirement
    ),

    requirement_seq: $ => seq('{', repeat($._requirement), '}'),

    constraint_conjunction: $ => prec.left(PREC.LOGICAL_AND, seq(
      field('left', $._requirement_clause_constraint),
      field('operator', choice('&&', 'and')),
      field('right', $._requirement_clause_constraint))
    ),

    constraint_disjunction: $ => prec.left(PREC.LOGICAL_OR, seq(
      field('left', $._requirement_clause_constraint),
      field('operator', choice('||', 'or')),
      field('right', $._requirement_clause_constraint))
    ),

    _requirement_clause_constraint: $ => choice(
      // Primary expressions"
      $.true,
      $.false,
      $._class_name,
      $.fold_expression,
      $.lambda_expression,
      $.requires_expression,

      // Parenthesized expressions
      seq('(', $._expression, ')'),

      // conjunction or disjunction of the above
      $.constraint_conjunction,
      $.constraint_disjunction,
    ),

    requires_clause: $ => seq(
      'requires',
      field('constraint', $._requirement_clause_constraint)
    ),

    requires_parameter_list: $ => seq(
      '(',
      commaSep(choice(
        $.parameter_declaration,
        $.optional_parameter_declaration,
        $.variadic_parameter_declaration,
      )),
      ')'
    ),

    requires_expression: $ => seq(
      'requires',
      field('parameters', optional(alias($.requires_parameter_list, $.parameter_list))),
      field('requirements', $.requirement_seq)
    ),

    lambda_expression: $ => seq(
      field('captures', $.lambda_capture_specifier),
      optional(seq(
        field('template_parameters', $.template_parameter_list),
        optional(field('constraint', $.requires_clause)),
      )),
      optional(field('declarator', $.abstract_function_declarator)),
      field('body', $.compound_statement)
    ),

    lambda_capture_specifier: $ => prec(PREC.LAMBDA, seq(
      '[',
      choice(
        $.lambda_default_capture,
        commaSep($._expression),
        seq(
          $.lambda_default_capture,
          ',', commaSep1($._expression)
        )
      ),
      ']'
    )),

    lambda_default_capture: $ => choice('=', '&'),

    _fold_operator: $ => choice(...FOLD_OPERATORS),
    _binary_fold_operator: $ => choice(...FOLD_OPERATORS.map(operator => seq(field('operator', operator), '...', operator))),

    _unary_left_fold: $ => seq(
      field('left', '...'),
      field('operator', $._fold_operator),
      field('right', $._expression)
    ),
    _unary_right_fold: $ => seq(
      field('left', $._expression),
      field('operator', $._fold_operator),
      field('right', '...')
    ),
    _binary_fold: $ => seq(
      field('left', $._expression),
      $._binary_fold_operator,
      field('right', $._expression)
    ),

    fold_expression: $ => seq(
      '(',
      choice(
        $._unary_right_fold,
        $._unary_left_fold,
        $._binary_fold
      ),
      ')'
    ),

    parameter_pack_expansion: $ => prec(-1, seq(
      field('pattern', $._expression),
      '...'
    )),

    type_parameter_pack_expansion: $ => seq(
      field('pattern', $.type_descriptor),
      '...'
    ),

    sizeof_expression: ($, original) => prec.right(PREC.SIZEOF, choice(
      original,
      seq(
        'sizeof', '...',
        '(',
        field('value', $.identifier),
        ')'
      ),
    )),

    unary_expression: ($, original) => choice(
      original,
      prec.left(PREC.UNARY, seq(
        field('operator', choice('not', 'compl')),
        field('argument', $._expression)
      ))
    ),

    binary_expression: ($, original) => {
      const table = [
        ['<=>', PREC.THREE_WAY],
        ['or', PREC.LOGICAL_OR],
        ['and', PREC.LOGICAL_AND],
        ['bitor', PREC.INCLUSIVE_OR],
        ['xor', PREC.EXCLUSIVE_OR],
        ['bitand', PREC.BITWISE_AND],
        ['not_eq', PREC.EQUAL],
      ];

      return choice(
        ...original.members,
        ...table.map(([operator, precedence]) => {
          return prec.left(precedence, seq(
            field('left', $._expression),
            field('operator', operator),
            field('right', $._expression)
          ))
        }));
    },

    argument_list: $ => seq(
      '(',
      commaSep(choice($._expression, $.initializer_list)),
      ')'
    ),

    destructor_name: $ => prec(1, seq('~', $.identifier)),

    compound_literal_expression: ($, original) => choice(
      original,
      seq(
        field('type', $._class_name),
        field('value', $.initializer_list)
      )
    ),

    dependent_identifier: $ => seq('template', $.template_function),
    dependent_field_identifier: $ => seq('template', $.template_method),
    dependent_type_identifier: $ => seq('template', $.template_type),

    _scope_resolution: $ => prec(1, seq(
      field('scope', optional(choice(
        $._namespace_identifier,
        $.template_type,
        $.decltype,
        alias($.dependent_type_identifier, $.dependent_name)
      ))),
      '::',
    )),

    qualified_field_identifier: $ => seq(
      $._scope_resolution,
      field('name', choice(
        alias($.dependent_field_identifier, $.dependent_name),
        alias($.qualified_field_identifier, $.qualified_identifier),
        $.template_method,
        $._field_identifier
      ))
    ),

    qualified_identifier: $ => seq(
      $._scope_resolution,
      field('name', choice(
        alias($.dependent_identifier, $.dependent_name),
        $.qualified_identifier,
        $.template_function,
        $.identifier,
        $.operator_name,
        $.destructor_name
      )),
    ),

    qualified_type_identifier: $ => seq(
      $._scope_resolution,
      field('name', choice(
        alias($.dependent_type_identifier, $.dependent_name),
        alias($.qualified_type_identifier, $.qualified_identifier),
        $.template_type,
        $._type_identifier
      )),
    ),

    qualified_operator_cast_identifier: $ => seq(
      $._scope_resolution,
      field('name', choice(
        alias($.qualified_operator_cast_identifier, $.qualified_identifier),
        $.operator_cast
      ))
    ),

    _assignment_left_expression: ($, original) => choice(
      original,
      $.qualified_identifier,
    ),

    assignment_expression: ($, original) => choice(
      original,
      prec.right(PREC.ASSIGNMENT, seq(
        field('left', $._assignment_left_expression),
        field('operator', choice(
          'and_eq',
          'or_eq',
          'xor_eq'
        )),
        field('right', $._expression)
      ))
    ),

    operator_name: $ => prec(1, seq(
      'operator',
      choice(
        'co_await',
        '+', '-', '*', '/', '%',
        '^', '&', '|', '~',
        '!', '=', '<', '>',
        '+=', '-=', '*=', '/=', '%=', '^=', '&=', '|=',
        '<<', '>>', '>>=', '<<=',
        '==', '!=', '<=', '>=',
        '<=>',
        '&&', '||',
        '++', '--',
        ',',
        '->*',
        '->',
        '()', '[]',
        'xor', 'bitand', 'bitor', 'compl',
        'not', 'xor_eq', 'and_eq', 'or_eq', 'not_eq',
        'and', 'or',
        seq(choice('new', 'delete'), optional('[]')),
        seq('""', $.identifier)
      )
    )),

    this: $ => 'this',
    nullptr: $ => 'nullptr',

    concatenated_string: $ => seq(
      choice($.raw_string_literal, $.string_literal),
      repeat1(choice($.raw_string_literal, $.string_literal))
    ),

    literal_suffix: $ => token.immediate(/[a-zA-Z_]\w*/),

    user_defined_literal: $ => seq(
      choice(
        $.number_literal,
        $.char_literal,
        $.string_literal,
        $.raw_string_literal,
        $.concatenated_string
      ),
      $.literal_suffix
    ),

    _namespace_identifier: $ => alias($.identifier, $.namespace_identifier)
  }
});

function commaSep(rule) {
  return optional(commaSep1(rule));
}

function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}
