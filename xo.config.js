/** @type {import('xo').FlatXoConfig} */
const xoConfig = [
	{
		rules: {
			'require-unicode-regexp': 'off',
			'unicorn/prevent-abbreviations': 'off',
		},
	},
	{
		files: ['**/*.js'],
		rules: {
			'unicorn/consistent-class-member-order': ['error', {
				order: [
					'static-field',
					'static-block',
					'static-method',
					'private-field',
					'public-field',
					'constructor',
					'public-method',
					'private-method',
				],
			}],
		},
	},
];

export default xoConfig;
